import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Copy, Eye, RotateCcw, Wand2 } from 'lucide-react';
import {
  defaultPolish,
  effectiveAdjustments,
  FILTER_PRESETS,
  neutral,
  pixelAdjustments,
  type Adjustments,
  type PhotoElement,
  type PhotoPolish,
} from '@homecard/shared';
import { Section, Slider, Spinner, Toggle } from '@/components/ui';
import { autoEnhanceFor, polishedThumb, thumbUrl } from '@/lib/image';
import { useEditor, useProject } from '@/store/editor';
import { useUi } from '@/store/ui';

type SliderDef = { key: keyof Adjustments; label: string; min: number; max: number };
const MAIN: SliderDef[] = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1 },
  { key: 'warmth', label: 'Warmth', min: -1, max: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1 },
  { key: 'shadows', label: 'Lift shadows', min: -1, max: 1 },
  { key: 'vignette', label: 'Soft vignette', min: 0, max: 1 },
];
const MORE: SliderDef[] = [
  { key: 'contrast', label: 'Contrast', min: -1, max: 1 },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1 },
  { key: 'tint', label: 'Tint (green ↔ magenta)', min: -1, max: 1 },
  { key: 'fade', label: 'Matte fade', min: 0, max: 1 },
  { key: 'grain', label: 'Film grain', min: 0, max: 1 },
];

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

/** Non-destructive Photo Polish. The same pixel pipeline runs in the editor worker and on the server at print time. */
export function PolishPanel() {
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const selection = useEditor((s) => s.selection);
  const [more, setMore] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  if (!project) return null;
  const ed = useEditor.getState();
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;
  const photos = surface.elements.filter((e): e is PhotoElement => e.type === 'photo' && !!e.fill);
  const allPhotos = project.surfaces.flatMap((s) => s.elements.filter((e): e is PhotoElement => e.type === 'photo' && !!e.fill));
  const target = photos.find((p) => selection.includes(p.id)) ?? (selection.length ? null : photos[0] ?? null);

  if (!photos.length)
    return (
      <Section>
        <p className="text-[13px] text-ink-3">Place a photo on this side of the card to polish it.</p>
      </Section>
    );

  const fill = target?.fill;
  const polish: PhotoPolish = fill?.polish ?? defaultPolish();
  /** Slider drags coalesce into one undo step; pass `null` for discrete actions. */
  const setPolish = (recipe: (p: PhotoPolish) => void, key?: string | null) =>
    target && ed.updateElement(target.id, (el) => {
      if (el.type === 'photo' && el.fill) recipe(el.fill.polish);
    }, key === undefined ? `polish:${target.id}` : key);

  const toggleAuto = async (on: boolean) => {
    if (!target || !fill) return;
    if (!on) return setPolish((p) => void (p.auto = null), null);
    setAutoBusy(true);
    try {
      const auto = await autoEnhanceFor(fill.ref);
      setPolish((p) => void (p.auto = auto), null);
    } catch (err: any) {
      useUi.getState().toast(`Auto-Enhance failed: ${err.message}`, 'error');
    } finally {
      setAutoBusy(false);
    }
  };

  const applyToAll = async () => {
    if (!fill) return;
    const src = fill.polish;
    // Auto-Enhance is measured per photo; filters and slider moves are copied as-is.
    const autos = new Map<string, Adjustments | null>();
    for (const p of allPhotos) autos.set(p.fill!.ref, src.auto ? await autoEnhanceFor(p.fill!.ref).catch(() => null) : null);
    ed.edit((d) => {
      for (const s of d.surfaces)
        for (const e of s.elements)
          if (e.type === 'photo' && e.fill)
            e.fill.polish = { auto: autos.get(e.fill.ref) ?? null, filterId: src.filterId, filterStrength: src.filterStrength, user: { ...src.user } };
    });
    useUi.getState().toast(`Polish applied to ${allPhotos.length} photo${allPhotos.length === 1 ? '' : 's'}.`, 'ok');
  };

  return (
    <>
      {photos.length > 1 && (
        <Section title="Photo">
          <div className="flex flex-wrap gap-1.5">
            {photos.map((p) => (
              <button key={p.id} onClick={() => ed.select(p.id)} className={clsx('h-12 w-12 overflow-hidden rounded-md', target?.id === p.id ? 'ring-2 ring-brand ring-offset-1' : 'opacity-80 hover:opacity-100')}>
                <img src={thumbUrl(p.fill!.ref)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </Section>
      )}
      {!target || !fill ? (
        <Section>
          <p className="text-[13px] text-ink-3">Select a photo on the card to polish it.</p>
        </Section>
      ) : (
        <>
          <Section
            title="Magic"
            actions={<CompareButton elementId={target.id} />}
          >
            <div className="flex items-center gap-2">
              <Toggle checked={!!polish.auto} onChange={toggleAuto} label={<span className="flex items-center gap-1.5 font-medium text-ink"><Wand2 size={14} className="text-brand" /> Auto-Enhance</span>} hint="Balances exposure, lifts faces and adds gentle colour." />
              {autoBusy && <Spinner size={14} />}
            </div>
          </Section>
          <Section title="Filters">
            <div className="grid grid-cols-3 gap-2">
              <FilterTile label="Original" refId={fill.ref} polish={{ ...polish, filterId: null }} active={!polish.filterId} onClick={() => setPolish((p) => void (p.filterId = null), null)} />
              {FILTER_PRESETS.map((f) => (
                <FilterTile
                  key={f.id}
                  label={f.name}
                  title={f.description}
                  refId={fill.ref}
                  polish={{ ...polish, filterId: f.id, filterStrength: 1 }}
                  active={polish.filterId === f.id}
                  onClick={() => setPolish((p) => {
                    p.filterId = f.id;
                    if (!p.filterStrength) p.filterStrength = 1;
                  }, null)}
                />
              ))}
            </div>
            {polish.filterId && (
              <Slider label="Filter strength" min={0} max={1} value={polish.filterStrength} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPolish((p) => void (p.filterStrength = v))} onReset={() => setPolish((p) => void (p.filterStrength = 1))} />
            )}
          </Section>
          <Section
            title="Adjust"
            actions={
              <button className="btn btn-ghost btn-sm" onClick={() => setPolish((p) => void (p.user = neutral()), null)} title="Reset sliders">
                <RotateCcw size={13} /> Reset
              </button>
            }
          >
            {[...MAIN, ...(more ? MORE : [])].map((s) => (
              <Slider
                key={s.key}
                label={s.label}
                min={s.min}
                max={s.max}
                value={polish.user[s.key]}
                format={s.min < 0 ? pct : (v) => `${Math.round(v * 100)}%`}
                onChange={(v) => setPolish((p) => void (p.user[s.key] = v))}
                onReset={() => setPolish((p) => void (p.user[s.key] = 0))}
              />
            ))}
            <button className="btn btn-ghost btn-sm mt-1" onClick={() => setMore((v) => !v)}>
              {more ? 'Fewer controls' : 'More controls'}
            </button>
          </Section>
          <Section>
            <div className="flex flex-wrap gap-1.5">
              {allPhotos.length > 1 && (
                <button className="btn btn-sm" onClick={applyToAll}>
                  <Copy size={13} /> Apply to all photos
                </button>
              )}
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setPolish((p) => Object.assign(p, defaultPolish()), null)}
              >
                <RotateCcw size={13} /> Back to original
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-3">Polish never changes your original photo. At export the full-resolution original is processed with exactly the same settings.</p>
          </Section>
        </>
      )}
    </>
  );
}

export function CompareButton({ elementId, label = 'Hold to compare' }: { elementId: string; label?: string }) {
  const setCompare = useUi((s) => s.setCompare);
  useEffect(() => () => setCompare(elementId, false), [elementId, setCompare]);
  return (
    <button
      className="btn btn-sm select-none"
      title="Hold to see the original photo"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setCompare(elementId, true);
      }}
      onPointerUp={() => setCompare(elementId, false)}
      onPointerCancel={() => setCompare(elementId, false)}
      onKeyDown={(e) => e.key === ' ' && setCompare(elementId, true)}
      onKeyUp={(e) => e.key === ' ' && setCompare(elementId, false)}
    >
      <Eye size={13} /> {label}
    </button>
  );
}

function FilterTile({ label, title, refId, polish, active, onClick }: { label: string; title?: string; refId: string; polish: PhotoPolish; active: boolean; onClick: () => void }) {
  const [src, setSrc] = useState<string>(thumbUrl(refId));
  const adj = pixelAdjustments(effectiveAdjustments(polish));
  const key = JSON.stringify(adj);
  useEffect(() => {
    let alive = true;
    if (!Object.keys(adj).length) {
      setSrc(thumbUrl(refId));
      return;
    }
    polishedThumb(refId, adj, 220).then((u) => alive && setSrc(u), () => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId, key]);
  return (
    <button onClick={onClick} title={title} className="flex flex-col items-center gap-1">
      <span className={clsx('aspect-square w-full overflow-hidden rounded-lg', active ? 'ring-2 ring-brand ring-offset-1' : '')}>
        <img src={src} alt="" className="h-full w-full object-cover" />
      </span>
      <span className="w-full truncate text-center text-[11px] text-ink-2">{label}</span>
    </button>
  );
}
