import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Eye, EyeOff, Save, Search, Star, Trash2 } from 'lucide-react';
import {
  CARD_SIZES,
  changeFormat,
  changeGreeting,
  changeOccasion,
  defaultFavoriteSizes,
  findCardSize,
  formatDims,
  formatLength,
  fromUnit,
  getOccasion,
  getSize,
  getVendor,
  GREETING_STYLES,
  isCustomSizeId,
  isSideFold,
  makeFormat,
  MAX_CARD_IN,
  MAX_SAVED_SIZES,
  MIN_CARD_IN,
  OCCASION_CATEGORIES,
  OCCASIONS,
  round,
  SAVED_SIZE_PREFIX,
  savedSizeOption,
  searchOccasions,
  toUnit,
  uid,
  VENDOR_PRESETS,
  type CardFormat,
  type CardSize,
  type GreetingStyle,
  type LengthUnit,
  type OccasionCategory,
  type SavedCardSize,
  type UserPrefs,
} from '@homecard/shared';
import { OccasionGlyph } from '@/components/MiniCard';
import { Section, Segmented, Toggle } from '@/components/ui';
import { useEditor, useProject } from '@/store/editor';
import { useHolidays } from '@/store/holidays';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';
import { useUnits } from '@/lib/units';

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

const NO_SAVED: SavedCardSize[] = [];

function savePrefs(p: UserPrefs) {
  return useSession
    .getState()
    .savePrefs(p)
    .catch((e: Error) => useUi.getState().toast(`Couldn’t save your size settings: ${e.message}`, 'error'));
}

/** The size as people say it: "A6 · 105 × 148 mm", or just "5 × 7"" when the name already says it. */
function sizeDims(s: CardSize, units: LengthUnit): string | null {
  if (s.id === 'custom') return null;
  if (units === 'in' && !s.metric && !s.saved && s.name.includes('"')) return null;
  return formatDims(s.w, s.h, units);
}

/**
 * Card size, orientation, fold and printer. Sizes on the list are the person's starred ones (their
 * own saved sizes included); every other size is under "More sizes". Sizes show in inches or mm.
 */
export function FormatFields({ value, onChange }: { value: FormatChoice; onChange: (v: FormatChoice) => void }) {
  const prefs = useSession((s) => s.user?.prefs);
  const units = useUnits();
  const [name, setName] = useState('');
  const saved = prefs?.savedSizes ?? NO_SAVED;
  const favorites = prefs?.favoriteSizes ?? defaultFavoriteSizes(units);
  const favSet = new Set(favorites);
  // A card made at a saved size that has since been deleted is just a custom size now.
  const current = findCardSize(value.sizeId, saved) ?? getSize(isCustomSizeId(value.sizeId) ? 'custom' : value.sizeId);
  const vendor = getVendor(value.vendorId);
  const set = (patch: Partial<FormatChoice>) => onChange({ ...value, ...patch });
  const fmt = makeFormat(value);
  const dims = (w: number, h: number) => formatDims(w, h, units);
  const len = (inches: number) => formatLength(inches, units);

  const shown = favorites.map((id) => findCardSize(id, saved)).filter((s): s is CardSize => !!s);
  if (current.id !== 'custom' && !favSet.has(current.id)) shown.push(current);
  const shownIds = new Set(shown.map((s) => s.id));
  const more = [...saved.map(savedSizeOption), ...CARD_SIZES.filter((s) => s.id !== 'custom')].filter((s) => !shownIds.has(s.id));
  const metricGroup = { label: 'ISO sizes (mm)', sizes: more.filter((s) => s.metric) };
  const inchGroup = { label: 'Inch sizes', sizes: more.filter((s) => !s.metric && !s.saved) };
  const groups = [{ label: 'Your saved sizes', sizes: more.filter((s) => s.saved) }, ...(units === 'mm' ? [metricGroup, inchGroup] : [inchGroup, metricGroup])].filter((g) => g.sizes.length);

  const pick = (s: CardSize) => {
    if (s.saved) {
      const land = value.orientation === 'landscape' && s.orientations.length > 1;
      set({ sizeId: s.id, customW: land ? s.h : s.w, customH: land ? s.w : s.h, orientation: land ? 'landscape' : 'portrait' });
    } else {
      set({ sizeId: s.id, orientation: s.orientations.includes(value.orientation) ? value.orientation : 'portrait' });
    }
  };
  // Start from the size already chosen, so "A6, but 2 mm narrower" is quick.
  const pickCustom = () => set({ sizeId: 'custom', customW: fmt.widthIn, customH: fmt.heightIn });
  const orient = (o: FormatChoice['orientation']) =>
    current.saved ? set({ orientation: o, customW: o === 'landscape' ? current.h : current.w, customH: o === 'landscape' ? current.w : current.h }) : set({ orientation: o });
  const toggleFav = (id: string) => void savePrefs({ favoriteSizes: favSet.has(id) ? favorites.filter((x) => x !== id) : [...favorites, id] });

  const saveSize = () => {
    if (saved.length >= MAX_SAVED_SIZES) return;
    const id = uid().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12);
    const w = Math.min(fmt.widthIn, fmt.heightIn);
    const h = Math.max(fmt.widthIn, fmt.heightIn);
    const label = name.trim().slice(0, 40) || dims(w, h);
    void savePrefs({ savedSizes: [...saved, { id, name: label, w, h }], favoriteSizes: [...favorites, SAVED_SIZE_PREFIX + id] });
    set({ sizeId: SAVED_SIZE_PREFIX + id, customW: fmt.widthIn, customH: fmt.heightIn });
    setName('');
  };
  const deleteSaved = (s: CardSize) => {
    void savePrefs({ savedSizes: saved.filter((x) => SAVED_SIZE_PREFIX + x.id !== s.id), favoriteSizes: favorites.filter((x) => x !== s.id) });
    // The card keeps its measurements; it just isn't linked to the saved size any more.
    if (value.sizeId === s.id) set({ sizeId: 'custom', customW: fmt.widthIn, customH: fmt.heightIn });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="label mb-0">Card size</span>
          <Segmented
            size="sm"
            value={units}
            onChange={(u) => void savePrefs({ units: u })}
            options={[
              { value: 'in', label: 'in', title: 'Show sizes in inches' },
              { value: 'mm', label: 'mm', title: 'Show sizes in millimetres' },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {shown.map((s) => (
            <SizeTile key={s.id} size={s} units={units} on={current.id === s.id} fav={favSet.has(s.id)} onPick={() => pick(s)} onStar={() => toggleFav(s.id)} />
          ))}
          <SizeTile size={getSize('custom')} units={units} on={current.id === 'custom'} onPick={pickCustom} title={`Any finished size from ${units === 'mm' ? '51 to 355 mm' : '2" to 14"'}`} />
        </div>
        {groups.length > 0 && (
          <select
            className="input mt-1.5 h-8 py-0 text-[12px]"
            value=""
            aria-label="More card sizes"
            onChange={(e) => {
              const s = findCardSize(e.target.value, saved);
              if (s) pick(s);
            }}
          >
            <option value="">More sizes…</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.sizes.map((s) => {
                  const d = sizeDims(s, units);
                  return (
                    <option key={s.id} value={s.id}>
                      {d ? `${s.name} · ${d}` : s.name}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        )}
        <p className="mt-1 text-[11px] text-ink-3">
          {current.id === 'custom'
            ? `Any finished size from ${units === 'mm' ? '51 to 355 mm' : '2" to 14"'}. Name and save it to pick it again on your next card.`
            : current.description}
          {current.id !== 'custom' && !favSet.has(current.id) && ' Star it to keep it on this list.'}
        </p>
        {current.saved && (
          <button type="button" className="mt-1 flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-bad" onClick={() => deleteSaved(current)}>
            <Trash2 size={11} /> Delete “{current.name}” from your sizes
          </button>
        )}
      </div>
      {current.id === 'custom' ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <LengthInput label="Width" inches={value.customW} units={units} onChange={(v) => set({ customW: v })} />
            <LengthInput label="Height" inches={value.customH} units={units} onChange={(v) => set({ customH: v })} />
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="label">Save this size</span>
              <input
                className="input h-8 text-[12px]"
                placeholder={`Name, e.g. “My card stock”`}
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveSize();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm h-8"
              disabled={saved.length >= MAX_SAVED_SIZES}
              title={saved.length >= MAX_SAVED_SIZES ? `You can keep up to ${MAX_SAVED_SIZES} sizes; delete one first.` : `Save ${dims(fmt.widthIn, fmt.heightIn)} to your sizes`}
              onClick={saveSize}
            >
              <Save size={13} /> Save
            </button>
          </div>
        </div>
      ) : (
        current.orientations.length > 1 && (
          <div>
            <div className="label">Orientation</div>
            <Segmented
              value={value.orientation}
              onChange={orient}
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
            : `Folds to ${dims(fmt.widthIn, fmt.heightIn)} (${isSideFold(fmt) ? 'side' : 'top'} fold). Printed as two ${isSideFold(fmt) ? dims(fmt.widthIn * 2, fmt.heightIn) : dims(fmt.widthIn, fmt.heightIn * 2)} spreads — outside and inside.`}
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
          {vendor.notes} Bleed {len(vendor.bleedIn)} · safe {len(vendor.safeIn)} · best file: {vendor.recommendedFormat.toUpperCase()}
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

function SizeTile({ size: s, units, on, fav, onPick, onStar, title }: { size: CardSize; units: LengthUnit; on: boolean; fav?: boolean; onPick: () => void; onStar?: () => void; title?: string }) {
  const k = 26 / Math.max(8, s.h);
  const d = sizeDims(s, units);
  return (
    <div className="group relative">
      <button
        type="button"
        title={title ?? s.description}
        onClick={onPick}
        className={clsx(
          'flex h-full w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition',
          on ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-2',
          onStar && 'pr-6',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-end justify-center">
          <span className="block border border-ink-3 bg-white" style={{ width: s.w * k, height: s.h * k }} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium">{s.name}</span>
          {d && <span className="block truncate text-[10.5px] text-ink-3">{d}</span>}
          {s.popularFor === units && <span className="block text-[10px] font-semibold uppercase text-brand">Most popular</span>}
        </span>
      </button>
      {onStar && (
        <button
          type="button"
          className={clsx(
            'absolute right-1 top-1 rounded p-0.5 transition hover:text-gold',
            fav ? 'text-gold opacity-50 hover:opacity-100 group-hover:opacity-100' : 'text-ink-3 opacity-70 hover:opacity-100',
            fav && 'focus-visible:opacity-100',
          )}
          aria-pressed={!!fav}
          aria-label={fav ? `Unstar ${s.name}: move it to More sizes` : `Star ${s.name}: keep it on this list`}
          title={fav ? 'Starred: always on this list. Click to move it to “More sizes”.' : 'Star this size to keep it on this list'}
          onClick={onStar}
        >
          <Star size={12} className={fav ? 'fill-gold' : ''} />
        </button>
      )}
    </div>
  );
}

/** A measurement box in the person's units. Only sensible values are passed on (in inches). */
function LengthInput({ label, inches, units, onChange }: { label: string; inches: number; units: LengthUnit; onChange: (inches: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const lo = toUnit(MIN_CARD_IN, units);
  const hi = toUnit(MAX_CARD_IN, units);
  return (
    <label>
      <span className="label">
        {label} ({units})
      </span>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        step={units === 'mm' ? 1 : 0.125}
        min={units === 'mm' ? 51 : MIN_CARD_IN}
        max={units === 'mm' ? 355 : MAX_CARD_IN}
        value={text ?? String(round(toUnit(inches, units), units === 'mm' ? 1 : 3))}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(v) && v >= lo - 1e-6 && v <= hi + 1e-6) onChange(fromUnit(v, units));
        }}
        onBlur={() => setText(null)}
      />
    </label>
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
