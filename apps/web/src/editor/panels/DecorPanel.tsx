import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Circle, Minus, Search, Square, Upload } from 'lucide-react';
import {
  BUILTIN_ORNAMENTS,
  getOccasion,
  ornamentsForOccasion,
  resolveColor,
  uid,
  type OrnamentDef,
  type OrnamentKind,
  type ScrimElement,
  type ShapeElement,
} from '@homecard/shared';
import { Section } from '@/components/ui';
import { addElement, addOrnament, addSticker } from '@/lib/actions';
import { upload } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { useProject } from '@/store/editor';
import { useUi } from '@/store/ui';

const KIND_LABEL: Record<OrnamentKind, string> = {
  ornament: 'Ornaments',
  divider: 'Dividers',
  corner: 'Corners',
  frame: 'Frames & borders',
  scatter: 'Scatters',
};

/** Ornaments, stickers, shapes and shades — built-ins plus everything in /data/styles. */
export function DecorPanel() {
  const project = useProject();
  const packs = useAssets((s) => s.packs);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'suggested' | OrnamentKind | 'stickers' | 'shapes'>('suggested');
  const aspects = useRef(new Map<string, number>());

  const packOrnaments = useMemo(() => packs.flatMap((p) => p.ornaments.map((o) => ({ ...o, pack: p.name, packOccasions: p.occasions }))), [packs]);
  const packStickers = useMemo(() => packs.flatMap((p) => p.stickers.map((o) => ({ ...o, pack: p.name }))), [packs]);
  if (!project) return null;
  const occ = getOccasion(project.occasionId);
  const theme = project.theme;
  const needle = q.trim().toLowerCase();
  const match = (name: string, tags: string[]) => !needle || name.toLowerCase().includes(needle) || tags.some((t) => t.includes(needle));

  const builtins: OrnamentDef[] =
    kind === 'suggested' ? ornamentsForOccasion(project.occasionId) : kind === 'stickers' || kind === 'shapes' ? [] : BUILTIN_ORNAMENTS.filter((o) => o.kind === kind);
  const shownBuiltins = builtins.filter((o) => match(o.name, o.tags));
  // "Suggested" only shows pack artwork from packs made for this occasion (or for every occasion);
  // a search or a kind chip looks through everything.
  const forOccasion = (o: { packOccasions: string[] }) => !o.packOccasions.length || o.packOccasions.includes(project.occasionId);
  const shownPackOrn =
    kind === 'stickers' || kind === 'shapes'
      ? []
      : packOrnaments.filter((o) => (kind === 'suggested' ? needle || forOccasion(o) : o.kind === kind) && match(o.name, o.tags));
  const shownStickers = kind === 'stickers' || (kind === 'suggested' && needle) ? packStickers.filter((s) => match(s.name, s.tags)) : [];

  const onUpload = async (files: File[], target: 'ornaments' | 'stickers') => {
    try {
      const r = await upload<{ saved: string[]; rejected: string[] }>(`/api/styles/upload?kind=${target}`, files);
      await useAssets.getState().loadStyles();
      useUi.getState().toast(r.saved.length ? `Added ${r.saved.length} file${r.saved.length > 1 ? 's' : ''} to My Uploads.` : 'Nothing was added.', r.saved.length ? 'ok' : 'error');
      if (r.rejected.length) useUi.getState().toast(`Not added: ${r.rejected.join(', ')}`, 'error');
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    }
  };

  const addShape = (shape: ShapeElement['shape']) => {
    const W = project.format.widthIn, H = project.format.heightIn;
    const w = shape === 'line' ? W * 0.5 : 1.6, h = shape === 'line' ? 0.04 : shape === 'ellipse' ? 1.6 : 1.1;
    addElement({
      id: uid('el'), type: 'shape', shape, x: W / 2 - w / 2, y: H / 2 - h / 2, w, h, rotation: 0, opacity: 1,
      fill: shape === 'line' ? '@accent' : '@surface', stroke: null, radius: shape === 'rect' ? 0.08 : 0,
    });
  };
  const addScrim = (direction: ScrimElement['direction']) => {
    const W = project.format.widthIn, H = project.format.heightIn, b = project.format.bleedIn;
    const full = direction === 'radial' || direction === 'solid';
    const h = full ? H + 2 * b : H * 0.45 + b;
    addElement({
      id: uid('el'), type: 'scrim', direction, x: -b, y: direction === 'to-top' ? H - h + b : -b, w: W + 2 * b, h, rotation: 0, opacity: 1,
      color: '@scrim', strength: direction === 'solid' ? 0.25 : 0.55, extent: direction === 'solid' ? 1 : 0.15,
    });
  };

  return (
    <>
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-paper px-4 py-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-8" placeholder="Search snowflake, heart, gold…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          <button className={clsx('chip', kind === 'suggested' && 'chip-on')} onClick={() => setKind('suggested')}>
            For {occ.name}
          </button>
          {(Object.keys(KIND_LABEL) as OrnamentKind[]).map((k) => (
            <button key={k} className={clsx('chip', kind === k && 'chip-on')} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <button className={clsx('chip', kind === 'stickers' && 'chip-on')} onClick={() => setKind('stickers')}>
            Stickers
          </button>
          <button className={clsx('chip', kind === 'shapes' && 'chip-on')} onClick={() => setKind('shapes')}>
            Shapes & shades
          </button>
        </div>
      </div>

      {kind !== 'stickers' && kind !== 'shapes' && (
        <Section title={kind === 'suggested' ? `Suggested for ${occ.name}` : KIND_LABEL[kind]}>
          {!shownBuiltins.length && !shownPackOrn.length && <p className="text-xs text-ink-3">Nothing matches “{q}”.</p>}
          <div className="grid grid-cols-4 gap-1.5">
            {shownBuiltins.map((o) => (
              <button
                key={o.id}
                title={`${o.name} — click to add (recolours with your palette)`}
                onClick={() => addOrnament(`builtin:${o.id}`)}
                className="flex aspect-square items-center justify-center rounded-lg border border-line p-2 transition hover:border-brand"
                style={{ background: theme.colors.background }}
              >
                <span
                  className="block h-full w-full"
                  style={{ color: theme.colors.accent, ['--hc-orn2' as any]: theme.colors.accent2 }}
                  dangerouslySetInnerHTML={{ __html: o.svg }}
                />
              </button>
            ))}
            {shownPackOrn.map((o) => (
              <button
                key={o.asset}
                title={`${o.name} — ${o.pack}`}
                onClick={() => addOrnament(o.asset, { aspect: aspects.current.get(o.asset) ?? 1, stretch: o.stretch })}
                className="flex aspect-square items-center justify-center rounded-lg border border-line p-2 transition hover:border-brand"
                style={{ background: theme.colors.background }}
              >
                <img
                  src={o.url}
                  alt=""
                  loading="lazy"
                  className="max-h-full max-w-full"
                  onLoad={(e) => {
                    const i = e.currentTarget;
                    if (i.naturalWidth && i.naturalHeight) aspects.current.set(o.asset, i.naturalWidth / i.naturalHeight);
                  }}
                />
              </button>
            ))}
          </div>
        </Section>
      )}

      {(kind === 'stickers' || shownStickers.length > 0) && (
        <Section title="Stickers">
          {!packStickers.length && <p className="mb-2 text-xs text-ink-3">Stickers are PNG or SVG images from your style packs. Upload your own below.</p>}
          <div className="grid grid-cols-3 gap-1.5">
            {shownStickers.map((s) => (
              <button key={s.asset} title={`${s.name} — ${s.pack}`} onClick={() => addSticker(s.asset, aspects.current.get(s.asset) ?? 1)} className="checker flex aspect-square items-center justify-center rounded-lg border border-line p-1.5 hover:border-brand">
                <img
                  src={s.url}
                  alt=""
                  loading="lazy"
                  className="max-h-full max-w-full"
                  onLoad={(e) => {
                    const i = e.currentTarget;
                    if (i.naturalWidth && i.naturalHeight) aspects.current.set(s.asset, i.naturalWidth / i.naturalHeight);
                  }}
                />
              </button>
            ))}
          </div>
        </Section>
      )}

      {kind === 'shapes' && (
        <>
          <Section title="Shapes">
            <div className="grid grid-cols-3 gap-1.5">
              <ShapeBtn label="Panel" onClick={() => addShape('rect')} icon={<Square size={20} />} />
              <ShapeBtn label="Circle" onClick={() => addShape('ellipse')} icon={<Circle size={20} />} />
              <ShapeBtn label="Line" onClick={() => addShape('line')} icon={<Minus size={20} />} />
            </div>
          </Section>
          <Section title="Shades (make text readable on photos)">
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['to-top', 'Bottom fade'],
                  ['to-bottom', 'Top fade'],
                  ['radial', 'Soft spotlight'],
                  ['solid', 'Even tint'],
                ] as Array<[ScrimElement['direction'], string]>
              ).map(([d, label]) => (
                <button key={d} onClick={() => addScrim(d)} className="flex items-center gap-2 rounded-lg border border-line bg-white p-2 text-left text-xs hover:border-brand">
                  <span
                    className="h-8 w-8 shrink-0 rounded"
                    style={{
                      background:
                        d === 'radial'
                          ? `radial-gradient(circle, transparent 30%, ${resolveColor('@scrim', theme)} 100%)`
                          : d === 'solid'
                            ? resolveColor('@scrim', theme)
                            : `linear-gradient(${d === 'to-top' ? 'to top' : 'to bottom'}, ${resolveColor('@scrim', theme)}, transparent)`,
                      opacity: 0.7,
                    }}
                  />
                  {label}
                </button>
              ))}
            </div>
          </Section>
        </>
      )}

      <Section title="Your own artwork">
        <div className="grid grid-cols-2 gap-1.5">
          <UploadBtn label="Upload SVG ornament" accept=".svg,image/svg+xml" onFiles={(f) => onUpload(f, 'ornaments')} />
          <UploadBtn label="Upload PNG sticker" accept=".png,.svg,.webp,image/png,image/webp" onFiles={(f) => onUpload(f, 'stickers')} />
        </div>
        <p className="mt-2 text-xs text-ink-3">Uploads land in /data/styles/_uploads. SVGs are sanitized and recolour with your palette; PNG stickers keep their colours.</p>
      </Section>
    </>
  );
}

function ShapeBtn({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-lg border border-line bg-white py-3 text-xs text-ink-2 hover:border-brand">
      {icon}
      {label}
    </button>
  );
}

function UploadBtn({ label, accept, onFiles }: { label: string; accept: string; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn btn-sm" onClick={() => ref.current?.click()}>
        <Upload size={13} /> {label}
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </>
  );
}
