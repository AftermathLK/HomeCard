import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import {
  applyTemplate,
  getTemplate,
  SURFACE_INFO,
  surfaceKind,
  templatesFor,
  type CardProject,
  type SurfaceId,
  type TemplateDef,
  type TemplateParams,
} from '@homecard/shared';
import { MiniCard } from '@/components/MiniCard';
import { Section, Slider } from '@/components/ui';
import { applyTemplateTo } from '@/lib/actions';
import { useAssets } from '@/lib/assets';
import { useMeasure } from '@/lib/units';
import { useEditor, useProject } from '@/store/editor';

const CATEGORY_LABEL: Record<TemplateDef['category'], string> = {
  'full-bleed': 'Full bleed',
  framed: 'Framed',
  collage: 'Collage',
  cutout: 'Cut-out',
  split: 'Split',
  typography: 'Type only',
  letter: 'Letter',
  postcard: 'Postcard',
};

const PARAM_META: Record<keyof TemplateParams, { label: string; min: number; max: number; step: number }> = {
  gutter: { label: 'Spacing between photos', min: 0, max: 0.4, step: 0.01 },
  radius: { label: 'Corner rounding', min: 0, max: 0.6, step: 0.01 },
  margin: { label: 'Border width', min: 0.1, max: 1, step: 0.01 },
};

/** Live template gallery: each thumbnail is the user's own card re-laid-out with that template. */
export function TemplatesPanel() {
  const { short } = useMeasure();
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const stylesVersion = useAssets((s) => s.stylesVersion);
  const packs = useAssets((s) => s.packs);
  const [cat, setCat] = useState<'all' | TemplateDef['category']>('all');
  const [photoCount, setPhotoCount] = useState<number | 'any'>('any');
  const [allPacks, setAllPacks] = useState(false);
  const deferred = useDeferredValue(project);

  const list = useMemo(
    () => templatesFor(surfaceKind(surfaceId)),
    // custom templates are re-registered when style packs reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surfaceId, stylesVersion],
  );
  if (!project || !deferred) return null;
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;
  const current = getTemplate(surface.templateId);
  // Style-pack layouts are offered for the occasions their pack was made for (packs without a list
  // count for every occasion); "All style-pack layouts" shows the rest. The current layout always shows.
  // Order: built-in layouts, then packs made for this occasion, then everything else.
  const packOccasions = new Map(packs.map((p) => [p.id, p.occasions]));
  const occasionsOf = (t: TemplateDef) => packOccasions.get(t.id.split(':')[0]);
  const forOccasion = (t: TemplateDef) => {
    if (t.source !== 'custom' || t.id === surface.templateId) return true;
    const occ = occasionsOf(t);
    return !occ || !occ.length || occ.includes(project.occasionId);
  };
  const rank = (t: TemplateDef) => (t.source !== 'custom' ? 0 : occasionsOf(t)?.includes(project.occasionId) ? 1 : 2);
  const offered = (allPacks ? list : list.filter(forOccasion)).slice().sort((a, b) => rank(a) - rank(b));
  const hiddenPackLayouts = list.length - offered.length;
  const cats = [...new Set(offered.map((t) => t.category))];
  const counts = [...new Set(offered.map((t) => t.photos))].sort((a, b) => a - b);
  const shown = offered.filter((t) => (cat === 'all' || t.category === cat) && (photoCount === 'any' || t.photos === photoCount));

  return (
    <>
      <Section title={`${SURFACE_INFO[surfaceId].label} layout`}>
        <div className="mb-2 flex flex-wrap gap-1">
          <button className={clsx('chip', cat === 'all' && 'chip-on')} onClick={() => setCat('all')}>
            All
          </button>
          {cats.map((c) => (
            <button key={c} className={clsx('chip', cat === c && 'chip-on')} onClick={() => setCat(c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        {counts.length > 1 && (
          <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-ink-3">
            Photos:
            <button className={clsx('chip', photoCount === 'any' && 'chip-on')} onClick={() => setPhotoCount('any')}>
              Any
            </button>
            {counts.map((n) => (
              <button key={n} className={clsx('chip', photoCount === n && 'chip-on')} onClick={() => setPhotoCount(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {shown.map((t) => (
            <TemplateThumb key={t.id} project={deferred} surfaceId={surfaceId} tpl={t} active={t.id === surface.templateId} />
          ))}
        </div>
        {(hiddenPackLayouts > 0 || allPacks) && (
          <button className="btn btn-sm mt-3 w-full" onClick={() => setAllPacks(!allPacks)}>
            {allPacks ? 'Only layouts for this occasion' : `Show all style-pack layouts (${hiddenPackLayouts} more)`}
          </button>
        )}
        <p className="mt-3 text-xs text-ink-3">Switching layouts keeps your photos, words and colours. Extra photos are remembered and come back if you switch to a layout with more frames.</p>
      </Section>
      {current.params.length > 0 && (
        <Section title="Fine-tune layout">
          {current.params.map((k) => {
            const m = PARAM_META[k];
            const v = surface.templateParams[k] ?? current.defaults[k];
            return (
              <Slider
                key={k}
                label={m.label}
                min={m.min}
                max={m.max}
                step={m.step}
                value={v}
                format={short}
                onChange={(x) => applyTemplateTo(surfaceId, current.id, { [k]: x })}
                onReset={() => applyTemplateTo(surfaceId, current.id, { [k]: current.defaults[k] })}
              />
            );
          })}
        </Section>
      )}
    </>
  );
}

/*
 * Lazy previews. Style packs can add thousands of layouts, so a thumbnail only lays out and draws
 * the card while it is in (or near) the visible part of its scrolling panel, and drops it again
 * when it scrolls far away. One IntersectionObserver per scroll container serves every thumbnail.
 */
const nearObservers = new WeakMap<object, IntersectionObserver>();
const nearCallbacks = new WeakMap<Element, (near: boolean) => void>();

function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

function observeNear(el: Element, cb: (near: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb(true);
    return () => {};
  }
  const root = scrollParent(el);
  const key = root ?? document;
  let io = nearObservers.get(key);
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) nearCallbacks.get(e.target)?.(e.isIntersecting);
    }, { root, rootMargin: '600px 0px' });
    nearObservers.set(key, io);
  }
  const obs = io;
  nearCallbacks.set(el, cb);
  obs.observe(el);
  return () => {
    obs.unobserve(el);
    nearCallbacks.delete(el);
  };
}

function useNearView<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => (ref.current ? observeNear(ref.current, setNear) : undefined), []);
  return [ref, near] as const;
}

const TemplateThumb = memo(function TemplateThumb({ project, surfaceId, tpl, active }: { project: CardProject; surfaceId: SurfaceId; tpl: TemplateDef; active: boolean }) {
  const [ref, near] = useNearView<HTMLButtonElement>();
  const { widthIn, heightIn } = project.format;
  const k = Math.min(130 / widthIn, 150 / heightIn);
  return (
    <button
      ref={ref}
      onClick={() => applyTemplateTo(surfaceId, tpl.id)}
      className={clsx('group flex flex-col items-center gap-1.5 rounded-xl p-2 text-left transition', active ? 'bg-brand-soft ring-2 ring-brand' : 'hover:bg-white')}
      title={tpl.description}
    >
      <div className="relative flex h-[150px] w-full items-center justify-center">
        {near || active ? (
          <ThumbPreview project={project} surfaceId={surfaceId} tplId={tpl.id} />
        ) : (
          <div className="rounded-sm bg-paper-3/70" style={{ width: Math.round(widthIn * k), height: Math.round(heightIn * k) }} />
        )}
        {active && (
          <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="w-full">
        <div className="truncate text-[12px] font-medium">{tpl.name}</div>
        <div className="text-[11px] text-ink-3">
          {tpl.photos ? `${tpl.photos} photo${tpl.photos > 1 ? 's' : ''}` : 'No photo'}
          {tpl.source === 'custom' ? ' · style pack' : ''}
        </div>
      </div>
    </button>
  );
});

function ThumbPreview({ project, surfaceId, tplId }: { project: CardProject; surfaceId: SurfaceId; tplId: string }) {
  const preview = useMemo(() => {
    try {
      const s = applyTemplate(project, surfaceId, tplId);
      return { ...project, surfaces: project.surfaces.map((x) => (x.id === surfaceId ? s : x)) };
    } catch {
      return null;
    }
  }, [project, surfaceId, tplId]);
  const surface = preview?.surfaces.find((s) => s.id === surfaceId);
  return preview && surface ? <MiniCard project={preview} surface={surface} width={130} height={150} /> : null;
}
