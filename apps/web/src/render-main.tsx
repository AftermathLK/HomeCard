/**
 * Headless print renderer. Loaded by the server's Chromium at device scale DPI/96:
 *   /render.html?job=<id>
 * It renders every page of the job with the same CardSurface the editor uses, waits until every
 * font face and every full-resolution photo is decoded, then reports through window.__HC_RENDER__.
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  parsePackAssetRef,
  resolveTokens,
  type CardProject,
  type FontFamilyInfo,
  type RenderJob,
  type RenderPageSpec,
  type RenderPageState,
  type RenderPhotoReport,
  type RenderReport,
  type ResolvedStylePack,
} from '@homecard/shared';
import './index.css';
import { applyPackTemplates, loadPackSvg, packSvgUrl, useAssets } from './lib/assets';
import { preloadImage } from './lib/image';
import { backgroundImageUrl, CardSurface, IN, RenderEnvContext, fontsUsed, textFont, type RenderEnv } from './render/CardSurface';

declare global {
  interface Window {
    __HC_RENDER__?: RenderPageState;
    __HC_SHOW__?: (i: number) => Promise<void>;
  }
}

const t0 = performance.now();
window.__HC_RENDER__ = { status: 'loading' };

const fail = (err: unknown) => {
  const msg = String((err as Error)?.message ?? err);
  console.error('[render]', msg);
  window.__HC_RENDER__ = { status: 'error', error: msg };
};

const raf2 = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
  return r.json() as Promise<T>;
}

function loadCss(href: string) {
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

function Page({ spec, index, job, packs }: { spec: RenderPageSpec; index: number; job: RenderJob; packs: ResolvedStylePack[] }) {
  const p = job.project;
  const f = p.format;
  /** Space between the page edge and the bleed edge (holds crop marks + the job label). */
  const slug = spec.bleed.y;
  return (
    <div
      data-page={index}
      style={{ position: 'relative', width: IN(spec.widthIn), height: IN(spec.heightIn), overflow: 'hidden', background: '#ffffff', breakAfter: 'page' }}
    >
      {spec.panels.map((panel) => {
        const surface = p.surfaces.find((s) => s.id === panel.surface);
        if (!surface) return null;
        return (
          <div
            key={panel.surface}
            data-panel={panel.surface}
            style={{ position: 'absolute', left: IN(panel.window.x), top: IN(panel.window.y), width: IN(panel.window.w), height: IN(panel.window.h), overflow: 'hidden' }}
          >
            <div
              style={{
                position: 'absolute',
                left: IN(panel.x - panel.window.x),
                top: IN(panel.y - panel.window.y),
                width: IN(f.widthIn),
                height: IN(f.heightIn),
                transform: panel.rotate ? 'rotate(180deg)' : undefined,
                transformOrigin: 'center',
              }}
            >
              <CardSurface project={p} surface={surface} packs={packs} />
            </div>
          </div>
        );
      })}
      {spec.marks.length > 0 && (
        <svg
          width={IN(spec.widthIn)}
          height={IN(spec.heightIn)}
          viewBox={`0 0 ${spec.widthIn * 72} ${spec.heightIn * 72}`}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        >
          {spec.marks.map((m, i) => (
            <line
              key={i}
              x1={m.x1 * 72}
              y1={m.y1 * 72}
              x2={m.x2 * 72}
              y2={m.y2 * 72}
              stroke="#000000"
              strokeWidth={0.3}
              strokeDasharray={m.kind === 'fold' ? '2 1.5' : undefined}
            />
          ))}
          {slug >= 0.12 && (
            <text x={(spec.trim.x + 0.3) * 72} y={spec.heightIn * 72 - 4} fontSize={5} fontFamily="sans-serif" fill="#000">
              {`${p.name} · ${spec.label} · ${f.widthIn}×${f.heightIn} in trim · bleed ${f.bleedIn} in · ${Math.round(job.dpi)} DPI · HomeCard`}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

function photoName(project: CardProject, ref: string) {
  return project.photos.find((p) => p.ref === ref)?.name ?? ref.replace(/^(immich|library):/, '');
}

async function main() {
  const id = new URLSearchParams(location.search).get('job');
  if (!id) throw new Error('Missing ?job=');
  const [job, styles, fonts] = await Promise.all([
    getJson<RenderJob>(`/api/render/jobs/${encodeURIComponent(id)}`),
    getJson<{ version: number; packs: ResolvedStylePack[] }>('/api/styles'),
    getJson<{ version: number; families: FontFamilyInfo[] }>('/api/fonts'),
  ]);
  const project = job.project;
  const packs = styles.packs;
  applyPackTemplates(packs);
  useAssets.setState({ packs, fonts: fonts.families, stylesVersion: styles.version, fontsVersion: fonts.version });
  await loadCss(`/api/fonts/fonts.css?v=${fonts.version}`);

  const warnings: string[] = [];
  const rendered = new Set(job.pages.flatMap((pg) => pg.surfaces));
  const surfaces = project.surfaces.filter((s) => rendered.has(s.id));

  // 1. Fonts: load every face with the exact characters it must render (unicode-range subsets).
  const declared = new Set<string>();
  document.fonts.forEach((ff) => declared.add(ff.family.replace(/^["']|["']$/g, '')));
  const used = fontsUsed({ ...project, surfaces });
  const missing: string[] = [];
  const textFor = new Map<string, string>();
  for (const s of surfaces)
    for (const e of s.elements) {
      if (e.type !== 'text' || e.hidden) continue;
      const f = textFont(e, project.theme);
      const k = `${f.family}|${f.weight}|${f.style}`;
      const t = resolveTokens(e.text, project);
      textFor.set(k, (textFor.get(k) ?? '') + t + t.toUpperCase());
    }
  await Promise.all(
    used.map(async (f) => {
      if (!declared.has(f.family)) {
        missing.push(f.family);
        return;
      }
      const sample = textFor.get(`${f.family}|${f.weight}|${f.style}`) || 'Aa';
      const faces = await document.fonts.load(`${f.style} ${f.weight} 24px "${f.family}"`, sample).catch(() => []);
      if (!faces.length) missing.push(`${f.family} ${f.weight}${f.style === 'italic' ? ' italic' : ''}`);
    }),
  );

  // 2. Style-pack SVGs (inlined) and textures.
  const svgRefs = new Set<string>();
  const imageUrls = new Set<string>(['/textures/grain.png']);
  for (const s of surfaces) {
    if (s.background.texture) {
      // Same URL the surface will draw (softened backgrounds are sized for this job's DPI).
      const u = backgroundImageUrl(s.background, project.format, packs, { mode: job.images === 'print' ? 'print' : 'preview', dpi: job.dpi });
      if (u) imageUrls.add(u);
    }
    for (const e of s.elements) {
      if (e.type === 'ornament' && parsePackAssetRef(e.asset)) svgRefs.add(e.asset);
      if (e.type === 'sticker') {
        const u = packSvgUrl(e.asset);
        if (u) imageUrls.add(u);
      }
    }
  }
  const failedImages: string[] = [];
  await Promise.all([
    ...[...svgRefs].map((r) => loadPackSvg(r).catch(() => warnings.push(`Ornament not found: ${r}`))),
    ...[...imageUrls].map((u) => preloadImage(u).catch(() => failedImages.push(u))),
  ]);

  // 3. Mount all pages (visible, so text auto-fit measures real layout).
  const env: RenderEnv = { mode: job.images === 'print' ? 'print' : 'preview', dpi: job.dpi, showEmptySlots: false };
  const root = createRoot(document.getElementById('render-root')!);
  flushSync(() =>
    root.render(
      <RenderEnvContext.Provider value={env}>
        {job.pages.map((spec, i) => (
          <Page key={spec.name} spec={spec} index={i} job={job} packs={packs} />
        ))}
      </RenderEnvContext.Provider>,
    ),
  );
  await document.fonts.ready;
  // Re-run auto-fit once more now that every face is certainly active.
  useAssets.setState((s) => ({ fontLoadTick: s.fontLoadTick + 1 }));
  await raf2();

  // 4. Wait for every photo (full-resolution print sources) to load and decode.
  const imgs = [...document.images];
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          const done = () => img.decode().then(resolve, resolve);
          if (img.complete) done();
          else {
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }
        }),
    ),
  );
  for (const img of imgs) if (!img.naturalWidth) failedImages.push(img.getAttribute('data-ref') ?? img.src);
  await raf2();

  // 5. Report the real effective resolution of every placed photo.
  const photos: RenderPhotoReport[] = [];
  for (const img of document.querySelectorAll<HTMLImageElement>('img[data-hc-photo]')) {
    const pageEl = img.closest('[data-page]') as HTMLElement | null;
    const panel = img.closest('[data-panel]') as HTMLElement | null;
    const winIn = Number(img.dataset.win);
    const ref = img.dataset.ref ?? '';
    const fill = surfaces.flatMap((s) => s.elements).find((e) => e.id === img.dataset.hcPhoto);
    photos.push({
      page: job.pages[Number(pageEl?.dataset.page ?? 0)]?.name ?? '',
      surface: (panel?.dataset.panel ?? 'front') as RenderPhotoReport['surface'],
      elementId: img.dataset.hcPhoto ?? '',
      ref,
      name: photoName(project, ref),
      requestedPx: Number(img.dataset.req ?? 0),
      deliveredPx: img.naturalWidth,
      sourceWidth: fill && fill.type === 'photo' && fill.fill ? fill.fill.width : 0,
      effectiveDpi: winIn > 0 ? img.naturalWidth / winIn : 0,
      via: img.naturalWidth < Number(img.dataset.req ?? 0) ? 'original (smaller than print size)' : 'original',
    });
  }
  const pending = document.querySelectorAll('[data-pending="1"]').length;
  if (pending) warnings.push(`${pending} ornament(s) could not be loaded.`);

  window.__HC_SHOW__ = async (i: number) => {
    document.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      el.style.display = Number(el.dataset.page) === i ? 'block' : 'none';
    });
    window.scrollTo(0, 0);
    await raf2();
  };

  const report: RenderReport = {
    photos,
    fonts: { requested: used.map((f) => `${f.family} ${f.weight}${f.style === 'italic' ? ' italic' : ''}`), missing },
    failedImages,
    warnings,
    durationMs: Math.round(performance.now() - t0),
  };
  window.__HC_RENDER__ = { status: 'ready', report };
}

main().catch(fail);
