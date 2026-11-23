import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Search, Tag, X } from 'lucide-react';
import {
  HOLIDAY_KEYWORDS,
  isDatedOccasion,
  LOOKAHEAD_CHOICES,
  localIsoDay,
  MAX_CUSTOM_TAGS,
  nextOccurrence,
  OCCASION_CATEGORIES,
  OCCASIONS,
  searchOccasions,
  type HolidayPrefs,
  type ImmichTagsDto,
  type LookaheadDays,
  type Occasion,
} from '@homecard/shared';
import { OccasionGlyph } from '@/components/MiniCard';
import { Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { useHolidays } from '@/store/holidays';
import { useUi } from '@/store/ui';

const ALL_IDS = OCCASIONS.map((o) => o.id);

/** "Thu, Nov 26 · in 3 days" for dated holidays, "Any time" for the rest. */
function whenLabel(id: string, today: string): string {
  const o = nextOccurrence(id, today);
  if (!o) return 'Any time';
  const [y, m, d] = o.date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const away = o.ongoing ? 'today' : o.daysAway === 1 ? 'tomorrow' : `in ${o.daysAway} days`;
  return `${o.startsAtSundown ? 'From sundown ' : ''}${day} · ${away}`;
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={clsx('relative h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-brand' : 'bg-line-2')}
    >
      <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function HolidaySettings() {
  const prefs = useHolidays((s) => s.prefs);
  const save = useHolidays((s) => s.save);
  const linked = useAssets((s) => !!s.health?.immich.linked);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [tags, setTags] = useState<ImmichTagsDto | null>(null);
  const today = localIsoDay();

  useEffect(() => void useHolidays.getState().load(true), []);
  useEffect(() => {
    if (!linked) return;
    api.get<ImmichTagsDto>('/api/immich/tags').then(setTags, () => setTags({ available: false, tags: [], missingScopes: [] }));
  }, [linked]);

  const hidden = useMemo(() => new Set(prefs.hiddenOccasions), [prefs.hiddenOccasions]);
  const matching = useMemo(() => new Set((q.trim() ? searchOccasions(q) : OCCASIONS).map((o) => o.id)), [q]);
  const setHidden = (ids: Iterable<string>) => void save({ hiddenOccasions: [...new Set(ids)] });
  const show = (ids: string[]) => setHidden(prefs.hiddenOccasions.filter((id) => !ids.includes(id)));
  const hide = (ids: string[]) => setHidden([...prefs.hiddenOccasions, ...ids]);
  const datedIds = ALL_IDS.filter(isDatedOccasion);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="font-display text-lg">Holidays</h3>
        <p className="mt-1 text-[13px] text-ink-2">
          Choose which holidays HomeCard suggests on the home page and in “What are you celebrating?”. Only you see these settings.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-line bg-white p-4">
        <Toggle
          checked={prefs.showHomeBanner}
          onChange={(v) => void save({ showHomeBanner: v })}
          label="Show the upcoming holiday on the home page"
          hint="A welcome, a countdown with print timing, and photos from this time of year."
        />
        <label className="flex items-center gap-3 pl-[46px] text-[13px] text-ink-2">
          Feature holidays up to
          <select
            className="input w-auto py-1"
            value={prefs.lookaheadDays}
            disabled={!prefs.showHomeBanner}
            onChange={(e) => void save({ lookaheadDays: Number(e.target.value) as LookaheadDays })}
          >
            {LOOKAHEAD_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          ahead
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" placeholder="Search holidays…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn btn-sm" onClick={() => setHidden([])} disabled={!prefs.hiddenOccasions.length}>
            Show all
          </button>
          <button className="btn btn-sm" onClick={() => hide(datedIds)} title="Hide every dated holiday; life milestones stay">
            Hide all holidays
          </button>
        </div>
        {prefs.hiddenOccasions.length > 0 && (
          <p className="text-[12px] text-ink-3">
            {prefs.hiddenOccasions.length} hidden. Hidden holidays never appear on the home page, and the occasion picker tucks them behind “Show hidden occasions”.
          </p>
        )}

        {OCCASION_CATEGORIES.map((cat) => {
          const rows = OCCASIONS.filter((o) => o.category === cat.id && matching.has(o.id));
          if (!rows.length) return null;
          const ids = rows.map((o) => o.id);
          return (
            <section key={cat.id} className="overflow-hidden rounded-xl border border-line bg-white">
              <header className="flex items-center gap-2 border-b border-line bg-paper-2/60 px-4 py-2">
                <span className="panel-title flex-1">{cat.name}</span>
                <button className="text-[12px] font-medium text-brand hover:underline" onClick={() => show(ids)}>
                  Show all
                </button>
                <span className="text-ink-3">·</span>
                <button className="text-[12px] font-medium text-ink-3 hover:text-ink hover:underline" onClick={() => hide(ids)}>
                  Hide all
                </button>
              </header>
              <ul className="divide-y divide-line">
                {rows.map((o) => (
                  <HolidayRow
                    key={o.id}
                    occ={o}
                    when={whenLabel(o.id, today)}
                    visible={!hidden.has(o.id)}
                    onVisible={(v) => (v ? show([o.id]) : hide([o.id]))}
                    editing={editing === o.id}
                    onEdit={() => setEditing((e) => (e === o.id ? null : o.id))}
                    prefs={prefs}
                    tags={tags}
                    linked={linked}
                    onTags={(list) => void save({ customTagMap: { ...prefs.customTagMap, [o.id]: list } })}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {!matching.size && <p className="py-4 text-center text-[13px] text-ink-3">No holiday matches “{q}”.</p>}
      </div>
    </div>
  );
}

function HolidayRow({
  occ,
  when,
  visible,
  onVisible,
  editing,
  onEdit,
  prefs,
  tags,
  linked,
  onTags,
}: {
  occ: Occasion;
  when: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  editing: boolean;
  onEdit: () => void;
  prefs: HolidayPrefs;
  tags: ImmichTagsDto | null;
  linked: boolean;
  onTags: (list: string[]) => void;
}) {
  const pal = occ.palettes[0].colors;
  const mine = prefs.customTagMap[occ.id] ?? [];
  const dated = isDatedOccasion(occ.id);
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition', !visible && 'opacity-50 grayscale')}
          style={{ background: pal.background, color: pal.accent, ['--hc-orn2' as any]: pal.accent2 }}
        >
          <OccasionGlyph occasionId={occ.id} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={clsx('truncate text-[13px] font-medium', !visible && 'text-ink-3')}>{occ.name}</div>
          <div className="truncate text-[11.5px] text-ink-3">{when}</div>
        </div>
        {dated && (
          <button className={clsx('chip', (editing || mine.length > 0) && 'chip-on')} onClick={onEdit} title="Your own Immich tag names for this holiday">
            <Tag size={12} /> {mine.length ? `${mine.length} tag${mine.length === 1 ? '' : 's'}` : 'Tags'}
          </button>
        )}
        <span className="w-12 text-right text-[12px] text-ink-3">{visible ? 'Shown' : 'Hidden'}</span>
        <Switch on={visible} onChange={onVisible} label={`${visible ? 'Hide' : 'Show'} ${occ.name}`} />
      </div>
      {editing && dated && <TagEditor occ={occ} mine={mine} tags={tags} linked={linked} onChange={onTags} />}
    </li>
  );
}

function TagEditor({ occ, mine, tags, linked, onChange }: { occ: Occasion; mine: string[]; tags: ImmichTagsDto | null; linked: boolean; onChange: (list: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const listId = `hc-tags-${occ.id}`;
  const builtIn = (HOLIDAY_KEYWORDS[occ.id] ?? []).slice(0, 8);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (t.length > 60 || /[<>\u0000-\u001f]/.test(t)) {
      useUi.getState().toast('Tag names can be up to 60 characters, without < or >.', 'error');
      return;
    }
    if (mine.length >= MAX_CUSTOM_TAGS) {
      useUi.getState().toast(`Up to ${MAX_CUSTOM_TAGS} tags per holiday.`, 'error');
      return;
    }
    if (!mine.some((m) => m.toLowerCase() === t.toLowerCase())) onChange([...mine, t]);
    setDraft('');
  };
  return (
    <div className="ml-11 mt-2.5 space-y-2 rounded-lg bg-paper-2 p-3">
      <div className="label">Immich tag keywords</div>
      <div className="flex flex-wrap gap-1.5">
        {mine.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-white px-2 py-0.5 text-[12px] text-ink">
            {t}
            <button aria-label={`Remove ${t}`} className="text-ink-3 hover:text-bad" onClick={() => onChange(mine.filter((m) => m !== t))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="input h-7 w-56 py-0.5"
          list={tags?.available ? listId : undefined}
          placeholder="Add a tag name…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
        {tags?.available && (
          <datalist id={listId}>
            {tags.tags.map((t) => (
              <option key={t.value} value={t.value} />
            ))}
          </datalist>
        )}
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        Photos with these Immich tags rank first in “See pictures from this time”. Tags whose name already says it are found anyway, such as{' '}
        {builtIn.map((k, i) => (
          <span key={k}>
            {i ? ', ' : ''}“{k}”
          </span>
        ))}
        .
      </p>
      {linked && tags && !tags.available && tags.missingScopes.includes('tag.read') && (
        <p className="text-[11.5px] text-warn">
          Your Immich key doesn’t include the optional <code>tag.read</code> permission, so tags can’t be suggested or matched yet. Add it in Immich (Account Settings → API Keys) and save the
          key again under Immich connection.
        </p>
      )}
      {!linked && <p className="text-[11.5px] text-ink-3">Link your Immich account to get suggestions from your own tags.</p>}
    </div>
  );
}
