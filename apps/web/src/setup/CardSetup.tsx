import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Eye, EyeOff, Search } from 'lucide-react';
import {
  CARD_SIZES,
  changeFormat,
  changeGreeting,
  changeOccasion,
  getOccasion,
  getSize,
  getVendor,
  GREETING_STYLES,
  isSideFold,
  makeFormat,
  OCCASION_CATEGORIES,
  OCCASIONS,
  searchOccasions,
  VENDOR_PRESETS,
  type CardFormat,
  type GreetingStyle,
  type OccasionCategory,
} from '@homecard/shared';
import { OccasionGlyph } from '@/components/MiniCard';
import { Section, Segmented, Toggle } from '@/components/ui';
import { useEditor, useProject } from '@/store/editor';
import { useHolidays } from '@/store/holidays';

/* ---------------- Occasion catalog ---------------- */

/**
 * Occasion catalog. Occasions the person hid (Settings → Holidays) stay out of the list unless
 * asked for, except the one already chosen.
 */
export function OccasionGrid({
  value,
  onChange,
  columns = 3,
  hidden = [],
  onUnhide,
}: {
  value: string;
  onChange: (id: string) => void;
  columns?: number;
  hidden?: readonly string[];
  onUnhide?: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | OccasionCategory>('all');
  const [showHidden, setShowHidden] = useState(false);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const matching = useMemo(() => (q.trim() ? searchOccasions(q) : OCCASIONS).filter((o) => cat === 'all' || q.trim() || o.category === cat), [q, cat]);
  const hiddenHere = matching.filter((o) => hiddenSet.has(o.id) && o.id !== value).length;
  const list = showHidden ? matching : matching.filter((o) => !hiddenSet.has(o.id) || o.id === value);
  return (
    <div>
      <div className="relative mb-2">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className="input pl-8" placeholder="Search occasions — “xmas”, “baby”, “diwali”…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!q.trim() && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          <button className={clsx('chip', cat === 'all' && 'chip-on')} onClick={() => setCat('all')}>
            All
          </button>
          {OCCASION_CATEGORIES.map((c) => (
            <button key={c.id} className={clsx('chip', cat === c.id && 'chip-on')} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {list.map((o) => {
          const pal = o.palettes[0].colors;
          const on = o.id === value;
          const isHidden = hiddenSet.has(o.id);
          return (
            <div key={o.id} className="relative">
              <button
                onClick={() => onChange(o.id)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition',
                  on ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-white hover:border-line-2',
                  isHidden && !on && 'opacity-60',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: pal.background, color: pal.accent, ['--hc-orn2' as any]: pal.accent2 }}>
                  <OccasionGlyph occasionId={o.id} size={20} />
                </span>
                <span className={clsx('min-w-0', isHidden && onUnhide && 'pr-12')}>
                  <span className="block truncate text-[13px] font-medium leading-tight">{o.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">{isHidden ? 'Hidden' : o.when}</span>
                </span>
              </button>
              {isHidden && onUnhide && (
                <button
                  className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[11px] font-medium text-brand hover:border-brand"
                  title={`Show ${o.name} again on the home page and here`}
                  onClick={() => onUnhide(o.id)}
                >
                  <Eye size={11} /> Unhide
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!list.length && <p className="py-4 text-center text-[13px] text-ink-3">{hiddenHere ? 'Everything here is hidden.' : 'No occasion matches — try “Custom Blank”.'}</p>}
      {(hiddenHere > 0 || showHidden) && hidden.length > 0 && (
        <button className="mt-2.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-3 hover:text-brand" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
          {showHidden ? 'Hide hidden occasions again' : `Show ${hiddenHere} hidden occasion${hiddenHere === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}

export function GreetingStylePicker({ value, onChange }: { value: GreetingStyle; onChange: (s: GreetingStyle) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {GREETING_STYLES.map((g) => (
        <button
          key={g.id}
          onClick={() => onChange(g.id)}
          className={clsx('rounded-lg border px-2.5 py-1.5 text-left transition', value === g.id ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-2')}
        >
          <span className="block text-[13px] font-medium">{g.name}</span>
          <span className="block text-[11px] text-ink-3">{g.hint}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Format ---------------- */

export interface FormatChoice {
  sizeId: string;
  orientation: 'portrait' | 'landscape';
  fold: CardFormat['fold'];
  includeBack: boolean;
  vendorId: string;
  customW: number;
  customH: number;
}

export function formatChoiceOf(f: CardFormat): FormatChoice {
  return {
    sizeId: f.sizeId,
    orientation: f.widthIn > f.heightIn ? 'landscape' : 'portrait',
    fold: f.fold,
    includeBack: f.includeBack,
    vendorId: f.vendorId,
    customW: f.widthIn,
    customH: f.heightIn,
  };
}

export function FormatFields({ value, onChange }: { value: FormatChoice; onChange: (v: FormatChoice) => void }) {
  const size = getSize(value.sizeId);
  const vendor = getVendor(value.vendorId);
  const set = (patch: Partial<FormatChoice>) => onChange({ ...value, ...patch });
  const fmt = makeFormat(value);
  return (
    <div className="space-y-3">
      <div>
        <div className="label">Card size</div>
        <div className="grid grid-cols-2 gap-1.5">
          {CARD_SIZES.map((s) => (
            <button
              key={s.id}
              title={s.description}
              onClick={() => set({ sizeId: s.id, orientation: s.orientations.includes(value.orientation) ? value.orientation : 'portrait' })}
              className={clsx('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition', value.sizeId === s.id ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-2')}
            >
              <span className="flex h-7 w-7 shrink-0 items-end justify-center">
                <span className="block border border-ink-3 bg-white" style={{ width: (s.w / 8) * 26, height: (s.h / 8) * 26 }} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium">{s.name}</span>
                {s.popular && <span className="block text-[10px] font-semibold uppercase text-brand">Most popular</span>}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-ink-3">{size.description}</p>
      </div>
      {value.sizeId === 'custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Width (in)</span>
            <input className="input" type="number" step={0.125} min={2} max={14} value={value.customW} onChange={(e) => set({ customW: Number(e.target.value) || 5 })} />
          </label>
          <label>
            <span className="label">Height (in)</span>
            <input className="input" type="number" step={0.125} min={2} max={14} value={value.customH} onChange={(e) => set({ customH: Number(e.target.value) || 7 })} />
          </label>
        </div>
      ) : (
        size.orientations.length > 1 && (
          <div>
            <div className="label">Orientation</div>
            <Segmented
              value={value.orientation}
              onChange={(v) => set({ orientation: v })}
              options={[
                { value: 'portrait', label: 'Portrait (tall)' },
                { value: 'landscape', label: 'Landscape (wide)' },
              ]}
            />
          </div>
        )
      )}
      <div>
        <div className="label">Card type</div>
        <Segmented
          value={value.fold}
          onChange={(v) => set({ fold: v })}
          options={[
            { value: 'flat', label: 'Flat card' },
            { value: 'folded', label: 'Folded card' },
          ]}
        />
        <p className="mt-1 text-[11px] text-ink-3">
          {value.fold === 'flat'
            ? 'A single sheet — front and (optionally) a printed back. The most common photo card.'
            : `Folds to ${fmt.widthIn}×${fmt.heightIn}" (${isSideFold(fmt) ? 'side' : 'top'} fold). Printed as two ${isSideFold(fmt) ? fmt.widthIn * 2 : fmt.widthIn}×${isSideFold(fmt) ? fmt.heightIn : fmt.heightIn * 2}" spreads — outside and inside.`}
        </p>
        {value.fold === 'flat' && (
          <div className="mt-1.5">
            <Toggle checked={value.includeBack} onChange={(v) => set({ includeBack: v })} label="Design the back too" hint="Extra photos, a family letter, or a return address." />
          </div>
        )}
      </div>
      <div>
        <div className="label">Printing with</div>
        <select className="input" value={value.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
          {VENDOR_PRESETS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-ink-3">
          {vendor.notes} Bleed {vendor.bleedIn}" · safe {vendor.safeIn}" · best file: {vendor.recommendedFormat.toUpperCase()}
          {vendor.maxUploadMB ? ` · upload limit ${vendor.maxUploadMB} MB` : ''}.
        </p>
        {value.fold === 'folded' && !vendor.supportsFolded && (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-warn">
            <AlertTriangle size={12} /> {vendor.name} doesn’t offer custom folded cards — export the spreads for a local print shop instead.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- Guided step 1 / Studio "Card" tab ---------------- */

export function CardSetupPanel() {
  const project = useProject();
  const [fmt, setFmt] = useState<FormatChoice | null>(null);
  const hidden = useHolidays((s) => s.prefs.hiddenOccasions);
  if (!project) return null;
  const ed = useEditor.getState();
  const choice = fmt ?? formatChoiceOf(project.format);
  const occ = getOccasion(project.occasionId);

  const applyFormat = (v: FormatChoice) => {
    setFmt(v);
    const next = makeFormat(v);
    const p = useEditor.getState().project!;
    ed.commit(changeFormat(p, next));
    setFmt(null);
  };

  return (
    <>
      <Section title="Occasion">
        <OccasionGrid
          value={project.occasionId}
          columns={2}
          hidden={hidden}
          onUnhide={(id) => void useHolidays.getState().unhide(id)}
          onChange={(id) => {
            if (id === project.occasionId) return;
            const p = changeOccasion(project, id);
            ed.commit({ ...p, name: project.name.startsWith(occ.name) ? p.name.replace(occ.name, getOccasion(id).name) : project.name });
          }}
        />
        <p className="mt-2 text-xs text-ink-3">Changing the occasion swaps the greeting, palette and fonts. Your photos stay put.</p>
      </Section>
      <Section title="Greeting style">
        <GreetingStylePicker value={project.greetingStyle} onChange={(s) => ed.commit(changeGreeting(project, s, 0))} />
      </Section>
      <Section title="Size & printing">
        <FormatFields value={choice} onChange={applyFormat} />
      </Section>
      <Section title="Card name">
        <input className="input" value={project.name} onChange={(e) => ed.edit((d) => void (d.name = e.target.value), 'name')} />
      </Section>
    </>
  );
}
