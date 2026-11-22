import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Page } from 'playwright';
import sharp, { type Sharp } from 'sharp';
import {
  buildRenderPages,
  CSS_PX_PER_IN,
  DEFAULT_EXPORT_OPTIONS,
  formatInches,
  pagePixels,
  shareDpi,
  surfacesFor,
  uid,
  type CardProject,
  type ExportFileInfo,
  type ExportOptions,
  type ExportRecord,
  type RenderJob,
  type RenderPageSpec,
  type RenderPageState,
  type RenderReport,
  type SurfaceId,
} from '@homecard/shared';
import { config, renderOrigin } from '../config';
import { all, one, run } from '../db';
import { emitTo } from '../events';
import { findUserById } from '../security/users';
import { USER_ID_RE, userExportsDir } from '../storage/paths';
import { EphemeralScope } from '../util/ephemeral';
import { ensureDir, slugify, writeFileAtomic } from '../util/fsx';
import { withContext } from './browser';
import { convertPdfToCmyk, ghostscript, rasterizePdf, resolveCmykProfile } from './ghostscript';
import { dropJob, putJob, type JobOwner } from './jobs';
import { finalizePdf, inspectPdf, mergePdfs, srgbProfile } from './pdf';
import { findImageMetadata, scrubImage } from './privacy';

const MANIFEST = '.homecard-export.json';
const PROOF_DIR = '.proof';

/* ------------------------------------------------------------------ */
/* Render session: open /render.html for a job and hand back the page  */
/* ------------------------------------------------------------------ */

export interface RenderSession {
  page: Page;
  report: RenderReport;
  job: RenderJob;
  /** Private scratch space for this render (Immich originals land here and are wiped afterwards). */
  scope: EphemeralScope;
  /** Exact-pixel PNG of page i at the job DPI. */
  screenshot(i: number): Promise<Buffer>;
  /** Single-page vector PDF of page i. */
  pdf(i: number): Promise<Uint8Array>;
}

/**
 * Render `spec` for `owner`. The headless page authenticates with a one-off render grant bound to
 * this job and owner, so it can only read that owner's photos. Every full-resolution Immich
 * original fetched for it goes into a private ephemeral scope that is securely deleted in the
 * `finally` block, whether the render succeeds or fails.
 */
export async function withRender<T>(spec: Omit<RenderJob, 'id' | 'createdAt'>, owner: JobOwner, label: string, fn: (s: RenderSession) => Promise<T>): Promise<T> {
  const scope = await EphemeralScope.create(label);
  let jobId: string | null = null;
  try {
    const { job, grant } = putJob(spec, owner, scope);
    jobId = job.id;
    return await renderWith(job, grant.token, scope, fn);
  } finally {
    if (jobId) dropJob(jobId);
    await scope.dispose();
  }
}

async function renderWith<T>(job: RenderJob, token: string, scope: EphemeralScope, fn: (s: RenderSession) => Promise<T>): Promise<T> {
  const dsf = job.dpi / CSS_PX_PER_IN;
  const first = job.pages[0];
  const vp = { width: Math.ceil(first.widthIn * CSS_PX_PER_IN), height: Math.ceil(first.heightIn * CSS_PX_PER_IN) };
  {
    return await withContext(dsf, vp, token, async (ctx) => {
      const page = await ctx.newPage();
      const consoleErrors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
      page.on('pageerror', (e) => consoleErrors.push(e.message));
      // Record which source each print image really came from (original / RAW full-size / preview).
      // The page can't read response headers, so the server-side page listener fills this in.
      const sources = new Map<string, { via: string; width: number }>();
      page.on('response', (r) => {
        const u = r.url();
        if (!u.includes('/api/media/print?')) return;
        try {
          const ref = new URL(u).searchParams.get('ref');
          if (!ref || r.status() >= 400) return;
          const h = r.headers();
          sources.set(ref, { via: h['x-source-via'] ?? 'original', width: Number(h['x-source-width'] ?? 0) });
        } catch {
          /* ignore malformed URLs */
        }
      });
      const url = `${renderOrigin()}/render.html?job=${encodeURIComponent(job.id)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      try {
        await page.waitForFunction(() => {
          const s = (window as any).__HC_RENDER__;
          return !!s && s.status !== 'loading';
        }, null, { timeout: 5 * 60_000, polling: 200 });
      } catch {
        throw new Error(`Renderer timed out loading ${url}. ${consoleErrors.slice(0, 3).join(' | ')}`);
      }
      const state = (await page.evaluate(() => (window as any).__HC_RENDER__)) as RenderPageState;
      if (state.status === 'error') throw new Error(`Render page error: ${state.error}`);
      const report: RenderReport = state.report ?? { photos: [], fonts: { requested: [], missing: [] }, failedImages: [], warnings: [], durationMs: 0 };
      if (consoleErrors.length) report.warnings.push(...consoleErrors.slice(0, 5).map((e) => `Renderer console: ${e}`));
      for (const p of report.photos) {
        const src = sources.get(p.ref);
        if (!src) continue;
        if (src.width) p.sourceWidth = src.width;
        const smaller = p.deliveredPx < p.requestedPx;
        p.via =
          src.via === 'fullsize'
            ? 'Immich full-size render of the RAW file'
            : src.via === 'preview'
              ? 'Immich preview (RAW original could not be decoded)'
              : smaller
                ? 'original file (smaller than the print size)'
                : 'original file';
        if (src.via === 'preview') report.warnings.push(`“${p.name}” was printed from Immich’s preview image because its RAW original could not be decoded.`);
      }

      const show = async (i: number) => {
        const spec = job.pages[i];
        await page.setViewportSize({ width: Math.ceil(spec.widthIn * CSS_PX_PER_IN), height: Math.ceil(spec.heightIn * CSS_PX_PER_IN) });
        await page.evaluate((idx) => (window as any).__HC_SHOW__(idx), i);
        return spec;
      };

      const session: RenderSession = {
        page,
        report,
        job,
        scope,
        async screenshot(i) {
          const spec = await show(i);
          const raw = await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, width: spec.widthIn * CSS_PX_PER_IN, height: spec.heightIn * CSS_PX_PER_IN },
            animations: 'disabled',
            caret: 'hide',
            scale: 'device',
            omitBackground: false,
          });
          return exactPixels(raw, pagePixels(spec, job.dpi));
        },
        async pdf(i) {
          const spec = await show(i);
          return page.pdf({
            width: `${spec.widthIn}in`,
            height: `${spec.heightIn}in`,
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            pageRanges: '1',
            preferCSSPageSize: false,
            tagged: false,
            outline: false,
          });
        },
      };
      return fn(session);
    });
  }
}

/**
 * Chromium rounds the clip to device pixels; make the bitmap EXACTLY w×h by cropping or
 * edge-replicating at most a pixel or two — never by resampling.
 */
async function exactPixels(png: Buffer, target: { w: number; h: number }): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w === target.w && h === target.h) return png;
  if (Math.abs(w - target.w) > 4 || Math.abs(h - target.h) > 4) {
    throw new Error(`Renderer produced ${w}×${h}px, expected ${target.w}×${target.h}px`);
  }
  let img = sharp(png).extract({ left: 0, top: 0, width: Math.min(w, target.w), height: Math.min(h, target.h) });
  const buf = await img.png().toBuffer();
  if (w >= target.w && h >= target.h) return buf;
  img = sharp(buf).extend({ right: Math.max(0, target.w - w), bottom: Math.max(0, target.h - h), extendWith: 'copy' });
  return img.png().toBuffer();
}

/* ------------------------------------------------------------------ */
/* Export records                                                      */
/* ------------------------------------------------------------------ */

/*
 * Exports live in /data/exports/<userId>/<slug>/<stamp>_<format>/ with a manifest file.
 * Ownership is recorded in SQLite (exports.owner_id) AND implied by the folder; every lookup
 * checks both against the signed-in user, so another user's export id answers 404.
 */
interface OwnedExport {
  rec: ExportRecord;
  ownerId: string;
}
const records = new Map<string, OwnedExport>();
let loaded: Promise<void> | null = null;

export function loadExportIndex() {
  loaded ??= (async () => {
    await ensureDir(config.dirs.exports);
    const seen = new Set<string>();
    async function walk(ownerId: string, dir: string, depth: number) {
      if (depth > 3) return;
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        let rec: ExportRecord;
        try {
          rec = JSON.parse(await fsp.readFile(path.join(abs, MANIFEST), 'utf8')) as ExportRecord;
        } catch {
          await walk(ownerId, abs, depth + 1);
          continue;
        }
        if (!rec?.id || path.resolve(userExportsDir(ownerId), rec.folder ?? '') !== abs) continue;
        const row = one<{ owner_id: string }>('SELECT owner_id FROM exports WHERE id = ?', rec.id);
        if (row && row.owner_id !== ownerId) continue; // same id claimed by two folders: keep the recorded owner
        if (!row) run('INSERT INTO exports(id, owner_id, project_id, folder, created_at) VALUES(?, ?, ?, ?, ?)', rec.id, ownerId, rec.projectId ?? '', rec.folder, Date.parse(rec.createdAt) || Date.now());
        if (rec.status === 'rendering' || rec.status === 'queued') {
          rec.status = 'error';
          rec.error = 'Interrupted (server restarted)';
        }
        records.set(rec.id, { rec, ownerId });
        seen.add(rec.id);
      }
    }
    for (const u of await fsp.readdir(config.dirs.exports, { withFileTypes: true }).catch(() => [])) {
      if (u.isDirectory() && USER_ID_RE.test(u.name) && findUserById(u.name)) await walk(u.name, path.join(config.dirs.exports, u.name), 0);
    }
    for (const r of all<{ id: string }>('SELECT id FROM exports')) if (!seen.has(r.id)) run('DELETE FROM exports WHERE id = ?', r.id);
  })();
  return loaded;
}

/** Re-read every user's export folders (after 1.0 data was moved into an account). */
export function rescanExports() {
  for (const [id, e] of records) if (e.rec.status !== 'queued' && e.rec.status !== 'rendering') records.delete(id);
  loaded = null;
  return loadExportIndex();
}

function owned(userId: string, id: string): OwnedExport | null {
  const entry = records.get(String(id));
  if (!entry || entry.ownerId !== userId) return null;
  const row = one<{ owner_id: string }>('SELECT owner_id FROM exports WHERE id = ?', entry.rec.id);
  return row?.owner_id === userId ? entry : null;
}

export function listExports(userId: string, projectId?: string) {
  return [...records.values()]
    .filter((e) => e.ownerId === userId && (!projectId || e.rec.projectId === projectId))
    .map((e) => e.rec)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getExport(userId: string, id: string) {
  return owned(userId, id)?.rec ?? null;
}

export function exportFolderAbs(userId: string, rec: ExportRecord) {
  const base = userExportsDir(userId);
  const abs = path.resolve(base, rec.folder);
  if (!abs.startsWith(base + path.sep)) throw new Error('Export folder escapes the user directory');
  return abs;
}

export async function deleteExport(userId: string, id: string) {
  const entry = owned(userId, id);
  if (!entry) return null;
  await fsp.rm(exportFolderAbs(userId, entry.rec), { recursive: true, force: true });
  records.delete(entry.rec.id);
  run('DELETE FROM exports WHERE id = ? AND owner_id = ?', entry.rec.id, userId);
  return entry.rec;
}

/** Drop a removed user's exports from memory (their folder was moved to the trash). */
export function forgetUserExports(userId: string) {
  for (const [id, e] of records) if (e.ownerId === userId) records.delete(id);
}

async function persist(entry: OwnedExport) {
  const { rec, ownerId } = entry;
  records.set(rec.id, entry);
  await writeFileAtomic(path.join(exportFolderAbs(ownerId, rec), MANIFEST), JSON.stringify(rec, null, 2)).catch(() => {});
  emitTo(ownerId, 'export', rec);
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function normalizeOptions(project: CardProject, o: Partial<ExportOptions>): ExportOptions {
  const valid = surfacesFor(project.format);
  const surfaces = (o.surfaces ?? valid).filter((s): s is SurfaceId => valid.includes(s as SurfaceId));
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    ...o,
    surfaces: surfaces.length ? surfaces : valid,
    dpi: Math.min(600, Math.max(150, Math.round(Number(o.dpi ?? 300)))),
    jpegQuality: Math.min(100, Math.max(90, Math.round(Number(o.jpegQuality ?? 100)))),
    layout: project.format.fold === 'folded' && o.layout === 'spreads' ? 'spreads' : 'panels',
    colorProfile: o.format === 'pdf' && o.colorProfile === 'cmyk' ? 'cmyk' : 'srgb',
  };
}

/** Queue an export; returns immediately with the record (progress is pushed over SSE to the owner only). */
export async function startExport(project: CardProject, partial: Partial<ExportOptions>, owner: JobOwner): Promise<ExportRecord> {
  await loadExportIndex();
  const options = normalizeOptions(project, partial);
  const slug = slugify(project.name || 'card', 40) || 'card';
  const folder = `${slug}/${stamp()}_${options.format}`;
  const rec: ExportRecord = {
    id: uid('x'),
    projectId: project.id,
    projectName: project.name,
    createdAt: new Date().toISOString(),
    status: 'queued',
    progress: 0,
    message: 'Queued',
    options,
    files: [],
    warnings: [],
    folder,
  };
  const entry: OwnedExport = { rec, ownerId: owner.userId };
  await ensureDir(exportFolderAbs(owner.userId, rec));
  run('INSERT INTO exports(id, owner_id, project_id, folder, created_at) VALUES(?, ?, ?, ?, ?)', rec.id, owner.userId, project.id, folder, Date.now());
  await persist(entry);
  void runExport(entry, project, owner).catch(async (err) => {
    rec.status = 'error';
    rec.error = String(err?.message ?? err);
    rec.message = 'Failed';
    await persist(entry);
  });
  return rec;
}

function sizeLabel(project: CardProject) {
  return `${formatInches(project.format.widthIn)}x${formatInches(project.format.heightIn)}`.replace(/[^0-9a-z.x]/gi, '');
}

async function fileInfo(abs: string, base: Omit<ExportFileInfo, 'bytes' | 'name'>): Promise<ExportFileInfo> {
  const st = await fsp.stat(abs);
  return { ...base, name: path.basename(abs), bytes: st.size };
}

/**
 * Read a written raster back: pixel size, DPI, and any privacy-relevant metadata still present
 * (EXIF/GPS, XMP, IPTC, comments, PNG text/time chunks).
 */
async function verifyRaster(buf: Buffer) {
  const meta = await sharp(buf).metadata();
  const found = findImageMetadata(buf);
  if (meta.exif && !found.includes('EXIF')) found.push('EXIF');
  if (meta.xmp && !found.includes('XMP')) found.push('XMP');
  if (meta.iptc && !found.includes('IPTC')) found.push('IPTC');
  return { widthPx: meta.width, heightPx: meta.height, density: meta.density, metadata: { clean: found.length === 0, found } };
}

/** Encode, strip every metadata block except DPI + ICC profile, write, and verify. */
async function writeClean(img: Sharp, abs: string, dpi?: number) {
  const buf = scrubImage(await img.toBuffer(), dpi);
  await fsp.writeFile(abs, buf);
  return verifyRaster(buf);
}

async function writeRaster(png: Buffer, abs: string, kind: 'png' | 'jpeg', dpi: number, quality: number) {
  // The source is Chromium's screenshot (no EXIF). withMetadata is only used to stamp the DPI;
  // scrubImage then removes everything except JFIF/pHYs density and the ICC profile.
  const img = sharp(png).withMetadata({ density: dpi }).withIccProfile('srgb');
  return writeClean(
    kind === 'png'
      ? img.png({ compressionLevel: 6, adaptiveFiltering: true })
      : img.jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: false, optimiseCoding: true, trellisQuantisation: false }),
    abs,
    dpi,
  );
}

async function runExport(entry: OwnedExport, project: CardProject, owner: JobOwner) {
  const { rec } = entry;
  const t0 = Date.now();
  const o = rec.options;
  const dir = exportFolderAbs(owner.userId, rec);
  const slug = slugify(project.name || 'card', 40) || 'card';
  const size = sizeLabel(project);
  const update = async (progress: number, message: string) => {
    rec.progress = Math.round(progress * 100) / 100;
    rec.message = message;
    await persist(entry);
  };
  rec.status = 'rendering';
  await update(0.02, 'Preparing pages');

  const isShare = o.format === 'share';
  const dpi = isShare ? shareDpi(project.format, 1080) : o.dpi;
  const pages = buildRenderPages(project.format, {
    surfaces: o.surfaces,
    includeBleed: isShare ? false : o.includeBleed,
    cropMarks: isShare ? false : o.cropMarks,
    layout: isShare ? 'panels' : o.layout,
  });
  await update(0.05, 'Loading full-resolution photos and fonts');

  const bleedTag = !isShare && o.includeBleed && project.format.bleedIn > 0 ? '_bleed' : '';
  const marksTag = !isShare && o.cropMarks ? '_marks' : '';

  await withRender({ project, pages, dpi, images: 'print' }, owner, 'export', async (s) => {
    rec.report = s.report;
    rec.warnings.push(...s.report.warnings);
    for (const f of s.report.failedImages) rec.warnings.push(`Image failed to load: ${f}`);
    if (s.report.fonts.missing.length) rec.warnings.push(`Fonts not found (fallback used): ${s.report.fonts.missing.join(', ')}`);
    const low = s.report.photos.filter((p) => p.effectiveDpi < 180);
    for (const p of low) rec.warnings.push(`${p.name} prints at ${Math.round(p.effectiveDpi)} DPI on the ${p.surface} — may look soft.`);
    const n = pages.length;

    if (o.format === 'png' || o.format === 'jpeg' || isShare) {
      const ext = isShare ? (o.shareFormat === 'png' ? 'png' : 'jpg') : o.format === 'png' ? 'png' : 'jpg';
      const kind = ext === 'png' ? 'png' : 'jpeg';
      const shots: Array<{ spec: RenderPageSpec; png: Buffer }> = [];
      for (let i = 0; i < n; i++) {
        const spec = pages[i];
        await update(0.1 + (0.75 * i) / n, `Rendering ${spec.label} at ${Math.round(dpi)} DPI`);
        const png = await s.screenshot(i);
        const name = isShare ? `${slug}_${spec.name}_share.${ext}` : `${slug}_${spec.name}_${size}${bleedTag}${marksTag}_${dpi}dpi.${ext}`;
        const abs = path.join(dir, name);
        const quality = isShare ? 92 : o.jpegQuality;
        const v = await writeRaster(png, abs, kind, isShare ? 72 : dpi, quality);
        if (isShare) shots.push({ spec, png });
        rec.files.push(
          await fileInfo(abs, {
            kind: isShare ? 'share' : 'print',
            surface: (spec.name as ExportFileInfo['surface']) ?? undefined,
            widthPx: v.widthPx,
            heightPx: v.heightPx,
            widthIn: spec.widthIn,
            heightIn: spec.heightIn,
            dpi: isShare ? undefined : dpi,
            mime: kind === 'png' ? 'image/png' : 'image/jpeg',
            colorSpace: 'sRGB',
            verified: { widthPx: v.widthPx, heightPx: v.heightPx, density: v.density, metadata: v.metadata },
          }),
        );
      }
      if (isShare && shots.length > 1) {
        await update(0.88, 'Composing share preview');
        const gap = 48;
        const metas = await Promise.all(shots.map((x) => sharp(x.png).metadata()));
        const H = Math.max(...metas.map((m) => m.height ?? 0));
        const W = metas.reduce((a, m) => a + (m.width ?? 0), 0) + gap * (shots.length + 1);
        let x = gap;
        const composites = shots.map((sh, i) => {
          const c = { input: sh.png, left: x, top: gap + Math.round((H - (metas[i].height ?? 0)) / 2) };
          x += (metas[i].width ?? 0) + gap;
          return c;
        });
        const abs = path.join(dir, `${slug}_all_share.jpg`);
        const v = await writeClean(
          sharp({ create: { width: W, height: H + gap * 2, channels: 3, background: '#f3f1ec' } })
            .composite(composites)
            .jpeg({ quality: 90 })
            .withIccProfile('srgb'),
          abs,
        );
        rec.files.push(
          await fileInfo(abs, { kind: 'share', surface: 'all', widthPx: W, heightPx: H + gap * 2, mime: 'image/jpeg', colorSpace: 'sRGB', verified: { widthPx: v.widthPx, heightPx: v.heightPx, metadata: v.metadata } }),
        );
      }
    } else if (o.format === 'pdf') {
      const parts: Uint8Array[] = [];
      for (let i = 0; i < n; i++) {
        await update(0.1 + (0.5 * i) / n, `Building vector PDF page: ${pages[i].label}`);
        parts.push(await s.pdf(i));
      }
      await update(0.62, 'Setting trim/bleed boxes and colour profile');
      const merged = await mergePdfs(parts);
      const cmyk = o.colorProfile === 'cmyk';
      const name = `${slug}_${size}${bleedTag}${marksTag}_${cmyk ? 'CMYK' : 'sRGB'}.pdf`;
      const abs = path.join(dir, name);
      let finalBytes: Uint8Array;
      let profileName = 'sRGB IEC61966-2.1';
      if (cmyk) {
        const profile = await resolveCmykProfile(o.iccProfile);
        if (!profile) rec.warnings.push('No CMYK ICC profile found — Ghostscript built-in conversion used.');
        // Intermediate PDFs contain the private photos: keep them in the ephemeral scope.
        const rgbTmp = s.scope.file('rgb', 'pdf');
        const cmykTmp = s.scope.file('cmyk', 'pdf');
        await fsp.writeFile(rgbTmp, await merged.save());
        await update(0.7, `Converting to CMYK${profile ? ` (${profile.name})` : ''}`);
        await convertPdfToCmyk(rgbTmp, cmykTmp, profile);
        const { PDFDocument } = await import('pdf-lib');
        // Ghostscript stamps Producer, dates and an XMP packet: finalizePdf scrubs them all.
        const converted = await PDFDocument.load(await fsp.readFile(cmykTmp), { updateMetadata: false });
        const icc = profile ? await fsp.readFile(profile.path) : null;
        finalBytes = await finalizePdf(converted, {
          title: project.name,
          pages,
          outputIntent: icc ? { icc, components: 4, identifier: profile!.name, info: profile!.name } : null,
        });
        profileName = profile?.name ?? 'DeviceCMYK';
      } else {
        finalBytes = await finalizePdf(merged, {
          title: project.name,
          pages,
          outputIntent: { icc: await srgbProfile(), components: 3, identifier: 'sRGB IEC61966-2.1', info: 'sRGB IEC61966-2.1' },
        });
      }
      await fsp.writeFile(abs, finalBytes);
      const insp = await inspectPdf(abs);

      // Proofs: rasterize the FINISHED PDF (what the print shop will see) at the export DPI.
      await update(0.8, 'Rasterizing proof from the finished PDF');
      const proofDir = path.join(dir, PROOF_DIR);
      await ensureDir(proofDir);
      const proofs: string[] = [];
      const gsAvailable = !!(await ghostscript());
      if (gsAvailable) {
        const pngs = await rasterizePdf(abs, proofDir, 'page', dpi);
        for (const [i, p] of pngs.entries()) {
          const out = path.join(proofDir, `page-${i + 1}.jpg`);
          await writeClean(sharp(p).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).withMetadata({ density: dpi }), out, dpi);
          await fsp.rm(p, { force: true });
          proofs.push(path.basename(out));
        }
      } else {
        rec.warnings.push('Ghostscript not found: proof images were captured from the renderer instead of the finished PDF.');
        for (let i = 0; i < n; i++) {
          const png = await s.screenshot(i);
          const out = path.join(proofDir, `page-${i + 1}.jpg`);
          await writeClean(sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).withMetadata({ density: dpi }), out, dpi);
          proofs.push(path.basename(out));
        }
      }
      const px = pagePixels(pages[0], dpi);
      rec.files.push(
        await fileInfo(abs, {
          kind: 'pdf',
          surface: 'all',
          widthIn: pages[0].widthIn,
          heightIn: pages[0].heightIn,
          widthPx: px.w,
          heightPx: px.h,
          dpi,
          mime: 'application/pdf',
          pages: insp.pages,
          proof: proofs[0] ?? null,
          colorSpace: cmyk ? 'CMYK' : 'sRGB',
          verified: { pageSizesIn: insp.pageSizesIn, trimBox: insp.trimBox, bleedBox: insp.bleedBox, fonts: insp.fonts, metadata: insp.metadata },
        }),
      );
      rec.proofs = proofs;
      rec.iccProfileName = profileName;
    }
  });
  for (const f of rec.files) {
    if (f.verified?.metadata && !f.verified.metadata.clean) rec.warnings.push(`${f.name} still contains metadata: ${f.verified.metadata.found.join(', ')}.`);
  }

  if (rec.files.length > 1) {
    await update(0.94, 'Packaging zip');
    const zip = new AdmZip();
    for (const f of rec.files) zip.addLocalFile(path.join(dir, f.name));
    const zipName = `${slug}_${o.format === 'share' ? 'share-pack' : `${o.format}_${size}`}.zip`;
    const zipAbs = path.join(dir, zipName);
    // Don't carry the export folder's file timestamps into the zip.
    for (const e of zip.getEntries()) e.header.time = new Date(2000, 0, 1);
    await zip.writeZipPromise(zipAbs);
    rec.files.push(await fileInfo(zipAbs, { kind: 'zip', surface: 'all', mime: 'application/zip' }));
  }

  rec.status = 'done';
  rec.progress = 1;
  rec.durationMs = Date.now() - t0;
  rec.message = `Done in ${(rec.durationMs / 1000).toFixed(1)} s`;
  await persist(entry);
}

/* ------------------------------------------------------------------ */
/* Project thumbnails (low-DPI render of the front using previews)     */
/* ------------------------------------------------------------------ */

export async function renderThumbnail(project: CardProject, outFile: string, owner: JobOwner) {
  const pages = buildRenderPages(project.format, { surfaces: ['front'], includeBleed: false, cropMarks: false, layout: 'panels' });
  await withRender({ project, pages, dpi: CSS_PX_PER_IN, images: 'preview' }, owner, 'thumb', async (s) => {
    const png = await s.screenshot(0);
    const buf = await sharp(png).resize(480, 480, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
    await writeFileAtomic(outFile, buf);
  });
}
