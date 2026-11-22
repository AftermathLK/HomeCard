import { useEffect, useMemo, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { Bookmark, Copy, Dice5, ExternalLink, ImageOff, Info, Search, Shapes, Sparkles, Trash2 } from 'lucide-react';
import {
  BACKDROPS,
  backdropDef,
  backdropSvg,
  backgroundDpi,
  BACKGROUND_DPI_MIN,
  newBackdrop,
  resolveColor,
  THEME_TOKEN_LABELS,
  type BackdropKind,
  type BackdropSpec,
  type CardProject,
  type ColorRef,
  type StockItem,
  type StockProviderId,
  type StockProviderInfo,
  type StockSearchResult,
  type StockSelection,
  type SurfaceBackground,
  type ThemeColors,
} from '@homecard/shared';
import { ColorField, Section, Segmented, Slider, Spinner, Swatch, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { textureUrl, useAssets } from '@/lib/assets';
import { useEditor, useProject } from '@/store/editor';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';

/**
 * Backgrounds & Textures: stock backgrounds (Pixabay, Unsplash, Openverse — all searched and
 * downloaded through the HomeCard server) and the offline Pattern & Paper Studio.
 */

type Tab = 'stock' | 'studio';

const PRESETS: Array<{ label: string; q: string; provider?: StockProviderId; imageType?: 'illustration' | 'vector' | 'photo' }> = [
  { label: 'Christmas watercolor pine', q: 'christmas watercolor pine', imageType: 'illustration' },
  { label: 'Gold bokeh', q: 'gold bokeh' },
  { label: 'Snowflakes seamless', q: 'snowflakes seamless pattern', imageType: 'vector' },
  { label: 'Hanukkah blue gold', q: 'hanukkah blue gold' },
  { label: 'New Year fireworks', q: 'new year fireworks' },
  { label: 'Autumn leaves', q: 'autumn leaves' },
  { label: 'Linen paper', q: 'linen paper texture', provider: 'unsplash' },
  { label: 'Snow bokeh', q: 'snow bokeh', provider: 'unsplash' },
  { label: 'Cozy wood', q: 'cozy wood texture', provider: 'unsplash' },
  { label: 'Florals', q: 'floral flat lay', provider: 'unsplash' },
];

const PIXABAY_COLORS = ['red', 'orange', 'yellow', 'green', 'turquoise', 'blue', 'lilac', 'pink', 'white', 'gray', 'black', 'brown', 'grayscale'];
const UNSPLASH_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'magenta', 'white', 'black', 'black_and_white'];
const COLOR_SWATCH: Record<string, string> = {
  red: '#c62828', orange: '#ef6c00', yellow: '#f9a825', green: '#2e7d32', turquoise: '#00897b', teal: '#00897b', blue: '#1565c0', lilac: '#9575cd',
  purple: '#6a1b9a', magenta: '#ad1457', pink: '#ec407a', white: '#ffffff', gray: '#9e9e9e', black: '#212121', brown: '#6d4c41',
  grayscale: 'linear-gradient(90deg,#000,#fff)', black_and_white: 'linear-gradient(90deg,#000,#fff)',
};

const toast = (t: string, k: 'ok' | 'error' | 'info' = 'info') => useUi.getState().toast(t, k);

/** Pixels per inch a cover-fit image of this size gives on this card (incl. bleed). */
function coverDpi(w: number, h: number, p: CardProject) {
  return backgroundDpi({ color: '#fff', texture: 'stock:x.jpg', textureMode: 'cover', textureWidth: w, textureHeight: h }, p.format) ?? 0;
}

function dpiTone(dpi: number) {
  return dpi >= 250 ? 'ok' : dpi >= BACKGROUND_DPI_MIN ? 'fine' : 'low';
}

export function BackgroundsPanel() {
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const [tab, setTab] = useState<Tab>(() => (project?.surfaces.find((s) => s.id === surfaceId)?.background.backdrop ? 'studio' : 'stock'));
  if (!project) return null;
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;
  return (
    <>
      <CurrentBackground project={project} surfaceId={surfaceId} bg={surface.background} />
      <div className="sticky top-0 z-10 border-b border-line bg-paper px-4 py-2.5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'stock', label: <span className="flex items-center gap-1"><Search size={13} /> Stock images</span> },
            { value: 'studio', label: <span className="flex items-center gap-1"><Shapes size={13} /> Pattern studio</span> },
          ]}
        />
      </div>
      {tab === 'stock' ? <StockBrowser project={project} surfaceId={surfaceId} /> : <PatternStudio project={project} surfaceId={surfaceId} bg={surface.background} />}
    </>
  );
}

/* ---------------- What's on this side now ---------------- */

function CurrentBackground({ project, surfaceId, bg }: { project: CardProject; surfaceId: string; bg: SurfaceBackground }) {
  const ed = useEditor.getState();
  const [saving, setSaving] = useState(false);
  if (!bg.texture && !bg.backdrop) return null;
  const set = (recipe: (b: SurfaceBackground) => void, key?: string) => ed.updateSurface(surfaceId as any, (s) => recipe(s.background), key);
  const dpi = backgroundDpi(bg, project.format);
  const tone = dpi === null ? null : dpiTone(dpi);
  const url = bg.texture ? textureUrl(bg.texture) : null;
  const isStock = !!bg.texture?.startsWith('stock:');
  const raster = !!bg.texture && /\.(png|jpe?g|webp)$/i.test(bg.texture);

  const saveLocal = async () => {
    if (!bg.texture) return;
    setSaving(true);
    try {
      const r = await api.post<{ ref: string }>('/api/stock/save', { ref: bg.texture });
      await useAssets.getState().loadStyles();
      // Point every side using this image at the permanent copy.
      const old = bg.texture;
      ed.edit((d) => {
        for (const s of d.surfaces) if (s.background.texture === old) s.background.texture = r.ref;
      });
      toast('Saved to your style library (My Uploads → Backgrounds). It stays available offline.', 'ok');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="On this side"
      actions={
        project.surfaces.length > 1 && (
          <button
            className="btn btn-ghost btn-sm"
            title="Use this background on every side"
            onClick={() =>
              ed.edit((d) => {
                for (const s of d.surfaces) s.background = structuredClone(bg);
              })
            }
          >
            <Copy size={13} /> All sides
          </button>
        )
      }
    >
      {bg.texture && (
        <div className="space-y-2">
          <div className="flex gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-2">
              {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageOff size={18} className="m-auto mt-5 text-ink-3" />}
            </div>
            <div className="min-w-0 flex-1 text-[12px]">
              <div className="truncate font-medium text-ink">{isStock ? 'Stock background' : 'Texture'}</div>
              {bg.credit && (
                <div className="truncate text-ink-3" title={bg.credit}>
                  {bg.creditUrl ? (
                    <a className="underline" href={bg.creditUrl} target="_blank" rel="noopener noreferrer">
                      {bg.credit}
                    </a>
                  ) : (
                    bg.credit
                  )}
                </div>
              )}
              {dpi !== null && (
                <div
                  className={clsx('mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', tone === 'ok' ? 'bg-ok-soft text-ok' : tone === 'fine' ? 'bg-paper-2 text-ink-2' : 'bg-warn-soft text-warn')}
                  title={`${bg.textureWidth}×${bg.textureHeight} px filling this ${project.format.widthIn}×${project.format.heightIn}" card with bleed`}
                >
                  ≈{Math.round(dpi)} DPI · {tone === 'ok' ? 'print sharp' : tone === 'fine' ? 'prints fine' : bg.soften ? 'softened for print' : 'low for print'}
                </div>
              )}
            </div>
            <button className="icon-btn self-start" title="Remove background image" onClick={() => set((b) => Object.assign(b, { texture: null, textureWidth: undefined, textureHeight: undefined, credit: null, creditUrl: null, soften: false }))}>
              <Trash2 size={15} />
            </button>
          </div>
          {raster && (
            <Toggle
              checked={!!bg.soften}
              onChange={(v) => set((b) => void (b.soften = v))}
              label="Soften / subtle blur"
              hint={dpi !== null && dpi < BACKGROUND_DPI_MIN ? 'Recommended: enlarges smoothly for print instead of showing pixels.' : 'Gently blurs the image — nice for bokeh and scenic backdrops.'}
            />
          )}
          <Slider label="Image strength" min={0.05} max={1} value={bg.textureOpacity ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((b) => void (b.textureOpacity = v), 'tex-op')} />
          {isStock && (
            <button className="btn btn-sm w-full" onClick={saveLocal} disabled={saving}>
              {saving ? <Spinner size={13} /> : <Bookmark size={13} />} Save to local styles
            </button>
          )}
        </div>
      )}
      {bg.backdrop && (
        <div className={clsx('flex items-center gap-2 text-[12px]', bg.texture && 'mt-3 border-t border-line pt-3')}>
          <Shapes size={15} className="text-brand" />
          <span className="flex-1">
            <span className="font-medium">{backdropDef(bg.backdrop.kind).name}</span> <span className="text-ink-3">· vector pattern</span>
          </span>
          <button className="icon-btn" title="Remove pattern" onClick={() => set((b) => void (b.backdrop = null))}>
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </Section>
  );
}

/* ---------------- Stock search ---------------- */

interface Filters {
  imageType: 'all' | 'photo' | 'illustration' | 'vector';
  color: string;
  orientation: 'all' | 'horizontal' | 'vertical';
}

let lastSearch: { provider: StockProviderId; q: string; filters: Filters; result: StockSearchResult | null } | null = null;

function StockBrowser({ project, surfaceId }: { project: CardProject; surfaceId: string }) {
  const health = useAssets((s) => s.health);
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  const providers: StockProviderInfo[] = health?.stock ?? [];
  const enabled = providers.filter((p) => p.enabled);
  const [provider, setProvider] = useState<StockProviderId>(lastSearch?.provider ?? enabled[0]?.id ?? 'openverse');
  const [q, setQ] = useState(lastSearch?.q ?? '');
  const [filters, setFilters] = useState<Filters>(lastSearch?.filters ?? { imageType: 'all', color: '', orientation: project.format.widthIn > project.format.heightIn ? 'horizontal' : 'vertical' });
  const [result, setResult] = useState<StockSearchResult | null>(lastSearch?.result ?? null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<StockSelection[] | null>(null);

  useEffect(() => {
    if (enabled.length && !enabled.some((p) => p.id === provider)) setProvider(enabled[0].id);
  }, [enabled, provider]);
  useEffect(() => {
    api.get<StockSelection[]>('/api/stock/recent').then(setRecent, () => setRecent([]));
  }, []);

  const search = async (opts?: { provider?: StockProviderId; q?: string; page?: number; filters?: Filters }) => {
    const pv = opts?.provider ?? provider;
    const text = (opts?.q ?? q).trim();
    const f = opts?.filters ?? filters;
    const page = opts?.page ?? 1;
    if (!text) return;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ provider: pv, q: text, page: String(page), imageType: f.imageType, orientation: f.orientation });
      if (f.color) params.set('color', f.color);
      const r = await api.get<StockSearchResult>(`/api/stock/search?${params}`);
      const merged = page > 1 && result ? { ...r, items: [...result.items, ...r.items] } : r;
      setResult(merged);
      lastSearch = { provider: pv, q: text, filters: f, result: merged };
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = (sel: StockSelection) => {
    const dpi = coverDpi(sel.width, sel.height, project);
    const soften = dpi < BACKGROUND_DPI_MIN;
    useEditor.getState().updateSurface(surfaceId as any, (s) => {
      Object.assign(s.background, {
        texture: sel.ref,
        textureMode: 'cover',
        textureOpacity: 1,
        textureWidth: sel.width,
        textureHeight: sel.height,
        soften,
        credit: sel.attribution.text,
        creditUrl: sel.attribution.sourceUrl ?? sel.attribution.authorUrl ?? null,
      });
    });
    if (soften) toast(`This image is ${sel.width}×${sel.height} px (≈${Math.round(dpi)} DPI on this card), so “Soften” is on for a smooth print. You can turn it off.`, 'info');
  };

  const pick = async (it: StockItem) => {
    setPicking(`${it.provider}:${it.id}`);
    try {
      apply(await api.post<StockSelection>('/api/stock/select', { provider: it.provider, id: it.id }));
      setRecent(null);
      api.get<StockSelection[]>('/api/stock/recent').then(setRecent, () => undefined);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setPicking(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void search();
  };

  if (!providers.length) return <div className="p-4"><Spinner /></div>;
  if (!enabled.length)
    return (
      <Section>
        <div className="flex items-start gap-2 text-[13px] text-ink-2">
          <Info size={16} className="mt-0.5 shrink-0 text-ink-3" />
          <div>
            Stock image search is turned off on this server.{' '}
            {isAdmin ? 'Turn on Openverse, or add a free Pixabay or Unsplash key, in Settings → Server.' : 'Ask your admin to enable it.'} The Pattern studio works offline.
          </div>
        </div>
      </Section>
    );

  const info = providers.find((p) => p.id === provider)!;
  const colors = provider === 'pixabay' ? PIXABAY_COLORS : provider === 'unsplash' ? UNSPLASH_COLORS : [];

  return (
    <>
      <Section>
        <div className="mb-2 flex flex-wrap gap-1">
          {providers.map((p) => (
            <button
              key={p.id}
              disabled={!p.enabled}
              title={p.enabled ? p.license : isAdmin ? `Turn on ${p.name} in Settings → Server` : 'Not enabled on this server'}
              className={clsx('chip', provider === p.id && 'chip-on', !p.enabled && 'opacity-40')}
              onClick={() => {
                setProvider(p.id);
                setResult(null);
                if (q.trim()) void search({ provider: p.id });
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <form className="relative" onSubmit={submit}>
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search backgrounds: “snowy forest”, “kraft paper”…" />
        </form>
        <div className="mt-2 flex flex-wrap gap-1">
          {PRESETS.filter((p) => !p.provider || enabled.some((x) => x.id === p.provider)).map((p) => (
            <button
              key={p.label}
              className="chip !text-[11px]"
              onClick={() => {
                const pv = p.provider ?? provider;
                const f = { ...filters, imageType: pv === 'pixabay' && p.imageType ? p.imageType : 'all' } as Filters;
                setQ(p.q);
                setProvider(pv);
                setFilters(f);
                void search({ provider: pv, q: p.q, filters: f });
              }}
            >
              <Sparkles size={11} /> {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {provider === 'pixabay' && (
            <select className="input !h-7 !w-auto !py-0 !text-[11px]" value={filters.imageType} onChange={(e) => { const f = { ...filters, imageType: e.target.value as Filters['imageType'] }; setFilters(f); void search({ filters: f }); }}>
              <option value="all">All types</option>
              <option value="illustration">Illustrations</option>
              <option value="vector">Vectors</option>
              <option value="photo">Photos</option>
            </select>
          )}
          <select className="input !h-7 !w-auto !py-0 !text-[11px]" value={filters.orientation} onChange={(e) => { const f = { ...filters, orientation: e.target.value as Filters['orientation'] }; setFilters(f); void search({ filters: f }); }}>
            <option value="all">Any shape</option>
            <option value="vertical">Portrait</option>
            <option value="horizontal">Landscape</option>
          </select>
          {colors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {colors.map((c) => (
                <button
                  key={c}
                  title={c.replace(/_/g, ' ')}
                  onClick={() => { const f = { ...filters, color: filters.color === c ? '' : c }; setFilters(f); void search({ filters: f }); }}
                  className={clsx('h-4 w-4 rounded-full border', filters.color === c ? 'ring-2 ring-brand ring-offset-1' : 'border-black/15')}
                  style={{ background: COLOR_SWATCH[c] ?? c }}
                />
              ))}
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink-3">{info.license}</p>
      </Section>

      {error && <div className="mx-4 mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[12px] text-bad">{error}</div>}

      {!result && recent && recent.length > 0 && (
        <Section title="Recently used">
          <div className="grid grid-cols-3 gap-1.5">
            {recent.slice(0, 12).map((r) => (
              <button key={r.ref} className="aspect-square overflow-hidden rounded-lg border border-line bg-paper-2 hover:ring-2 hover:ring-brand" title={r.attribution.text} onClick={() => apply(r)}>
                <img src={textureUrl(r.ref) ?? ''} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </Section>
      )}

      {!result && !busy && (!recent || !recent.length) && <p className="px-4 py-6 text-center text-[12px] text-ink-3">Pick a preset above or search. Images are downloaded to this server when you choose one — never hotlinked into your card.</p>}

      {result && (
        <div className="px-3 py-3">
          {!result.items.length ? (
            <p className="py-6 text-center text-[12px] text-ink-3">No results. Try other words{provider !== 'openverse' ? ' or another source' : ''}.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {result.items.map((it) => {
                const dpi = coverDpi(it.printWidth, it.printHeight, project);
                const tone = dpiTone(dpi);
                const key = `${it.provider}:${it.id}`;
                return (
                  <div key={key} className="group">
                    <button className="relative block aspect-[4/5] w-full overflow-hidden rounded-lg border border-line bg-paper-2 hover:ring-2 hover:ring-brand" onClick={() => pick(it)} disabled={!!picking} title={it.title}>
                      <img src={it.thumbUrl} alt={it.title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      <span
                        className={clsx('absolute left-1 top-1 rounded px-1 py-px text-[10px] font-semibold', tone === 'ok' ? 'bg-ok text-white' : tone === 'fine' ? 'bg-white/90 text-ink-2' : 'bg-warn text-white')}
                        title={`${it.printWidth}×${it.printHeight} px → about ${Math.round(dpi)} DPI on this card${tone === 'low' ? '. “Soften” is turned on automatically.' : ''}`}
                      >
                        {Math.round(dpi)} DPI
                      </span>
                      {picking === key && (
                        <span className="absolute inset-0 flex items-center justify-center bg-white/60">
                          <Spinner />
                        </span>
                      )}
                    </button>
                    <div className="mt-0.5 truncate text-[10px] text-ink-3" title={it.attribution.text}>
                      {it.attribution.authorUrl ? (
                        <a className="hover:underline" href={it.attribution.authorUrl} target="_blank" rel="noopener noreferrer">
                          {it.attribution.text}
                        </a>
                      ) : (
                        it.attribution.text
                      )}
                      {it.attribution.sourceUrl && (
                        <a className="ml-1 inline-flex align-middle text-ink-3 hover:text-ink" href={it.attribution.sourceUrl} target="_blank" rel="noopener noreferrer" title="Open source page">
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {result.hasMore && (
            <button className="btn btn-sm mt-3 w-full" disabled={busy} onClick={() => search({ page: result.page + 1 })}>
              {busy ? <Spinner size={13} /> : null} More results
            </button>
          )}
          {result.cached && <p className="mt-2 text-center text-[10px] text-ink-3">Results cached for 24 hours.</p>}
        </div>
      )}
      {busy && !result && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}
    </>
  );
}

/* ---------------- Pattern & Paper Studio ---------------- */

const TOKENS: ColorRef[] = ['@background', '@surface', '@accent', '@accent2', '@text', '@textMuted'];

function PatternStudio({ project, surfaceId, bg }: { project: CardProject; surfaceId: string; bg: SurfaceBackground }) {
  const ed = useEditor.getState();
  const spec = bg.backdrop ?? null;
  const set = (recipe: (b: SurfaceBackground) => void, key?: string) => ed.updateSurface(surfaceId as any, (s) => recipe(s.background), key);
  const setSpec = (patch: Partial<BackdropSpec>, key?: string) => set((b) => void (b.backdrop = b.backdrop ? { ...b.backdrop, ...patch } : null), key);
  const choose = (kind: BackdropKind) => set((b) => void (b.backdrop = b.backdrop?.kind === kind ? b.backdrop : newBackdrop(kind)));

  // Small live previews in the card's own colours (fewer motifs keep them light).
  const previews = useMemo(() => {
    const box = { widthIn: 1.25, heightIn: 1.6, bleedIn: 0 };
    return Object.fromEntries(BACKDROPS.map((d) => [d.kind, backdropSvg({ ...newBackdrop(d.kind, 7), scale: 0.6 }, project.theme, box, `hcpv${d.kind.replace(/-/g, '')}`)]));
  }, [project.theme]);
  const paper = resolveColor(bg.color, project.theme, '#ffffff');
  const def = spec ? backdropDef(spec.kind) : null;

  return (
    <>
      <Section>
        <p className="mb-2.5 text-[12px] text-ink-3">Crisp vector patterns drawn at any print resolution, fully offline. Colours follow your card palette — including Color Harmony from your photos.</p>
        <div className="grid grid-cols-3 gap-2">
          {BACKDROPS.map((d) => (
            <button key={d.kind} onClick={() => choose(d.kind)} className="flex flex-col items-center gap-1" title={d.description}>
              <span
                className={clsx('block aspect-[1.25/1.6] w-full overflow-hidden rounded-lg border shadow-sm', spec?.kind === d.kind ? 'border-brand ring-2 ring-brand ring-offset-1' : 'border-line')}
                style={{ background: paper }}
                dangerouslySetInnerHTML={{ __html: previews[d.kind] }}
              />
              <span className="w-full truncate text-center text-[10.5px] text-ink-2">{d.name}</span>
            </button>
          ))}
        </div>
      </Section>

      {spec && def && (
        <Section
          title={def.name}
          actions={
            <div className="flex gap-1">
              <button className="btn btn-ghost btn-sm" title="New random variation" onClick={() => setSpec({ seed: Math.floor(Math.random() * 1e9) })}>
                <Dice5 size={14} /> Shuffle
              </button>
              <button className="btn btn-ghost btn-sm" title="Remove pattern" onClick={() => set((b) => void (b.backdrop = null))}>
                <Trash2 size={14} />
              </button>
            </div>
          }
        >
          <p className="mb-2 text-[12px] text-ink-3">{def.description}</p>
          <Slider label="Amount" min={0} max={1} value={spec.density} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSpec({ density: v }, 'bd-density')} />
          <Slider label="Size" min={0.5} max={2} value={spec.scale} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setSpec({ scale: v }, 'bd-scale')} />
          <Slider label="Strength" min={0.05} max={1} value={spec.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSpec({ opacity: v }, 'bd-opacity')} />
          {(['primary', 'secondary', 'tertiary'] as const)
            .filter((k) => k !== 'tertiary' || def.defaults.colors.tertiary !== undefined)
            .map((k) => {
              const ref = spec.colors[k] ?? def.defaults.colors[k] ?? '@accent';
              return (
                <div key={k} className="mt-2.5">
                  <div className="label">{k === 'primary' ? 'Main colour' : k === 'secondary' ? 'Second colour' : 'Third colour'}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {TOKENS.map((tok) => (
                      <Swatch key={tok} size={22} color={resolveColor(tok, project.theme)} active={ref === tok} title={`${THEME_TOKEN_LABELS[tok.slice(1) as keyof ThemeColors] ?? tok} (follows the palette)`} onClick={() => setSpec({ colors: { ...spec.colors, [k]: tok } })} />
                    ))}
                    <span className="mx-0.5 h-5 w-px bg-line" />
                    <ColorField value={resolveColor(ref, project.theme, '#ffffff').slice(0, 7)} onChange={(hex) => setSpec({ colors: { ...spec.colors, [k]: hex } }, `bd-${k}`)} />
                  </div>
                </div>
              );
            })}
          <button className="btn btn-ghost btn-sm mt-3" onClick={() => setSpec({ ...structuredClone(def.defaults) })}>
            Reset to defaults
          </button>
        </Section>
      )}
    </>
  );
}
