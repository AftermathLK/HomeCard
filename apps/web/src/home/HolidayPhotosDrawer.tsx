import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, Heart, Info, RefreshCw, Sparkles, X } from 'lucide-react';
import { getOccasion, type HolidayPhotoMatch, type UpcomingPhotosDto } from '@homecard/shared';
import { Empty, Modal, Spinner } from '@/components/ui';
import { startCardWithPhotos } from '@/lib/startCard';
import { useUi } from '@/store/ui';
import { useHolidayPhotos } from './holidayPhotos';

export const MAX_START_PHOTOS = 6;
const TIP_KEY = 'hc.tip.tagRead.dismissed';

type TabId = 'all' | 'tagged' | 'past' | 'recent' | 'favorites';

const TABS: Array<{ id: TabId; label: string; test: (p: HolidayPhotoMatch) => boolean }> = [
  { id: 'all', label: 'All matches', test: () => true },
  { id: 'tagged', label: 'Tagged', test: (p) => p.kinds.includes('tag') || p.kinds.includes('album') },
  { id: 'past', label: 'Past years', test: (p) => p.kinds.includes('past') },
  { id: 'recent', label: 'Recent highlights', test: (p) => p.kinds.includes('recent') },
  { id: 'favorites', label: 'Favorites only', test: (p) => !!p.favorite },
];

/** "We looked at: tags Christmas · album Xmas 2024 · Dec 2021–2024 · the last 45 days". */
function signalsLine(d: UpcomingPhotosDto): string {
  const bits: string[] = [];
  if (d.signals.tags.length) bits.push(`tag${d.signals.tags.length > 1 ? 's' : ''} ${d.signals.tags.join(', ')}`);
  if (d.signals.albums.length) bits.push(`album${d.signals.albums.length > 1 ? 's' : ''} ${d.signals.albums.join(', ')}`);
  const years = [...d.signals.pastYears].sort();
  if (years.length) bits.push(`this time in ${years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0]}`);
  bits.push(`the last ${d.signals.recentDays} days`);
  if (d.signals.visual) bits.push('visual search');
  return `Searched ${bits.join(' · ')}.`;
}

export function HolidayPhotosDrawer({ occasionId, preselect, onClose }: { occasionId: string; preselect?: string; onClose: () => void }) {
  const occ = getOccasion(occasionId);
  const entry = useHolidayPhotos((s) => s.entries[occasionId]);
  const fetchPhotos = useHolidayPhotos((s) => s.fetch);
  const [tab, setTab] = useState<TabId>('all');
  const [selected, setSelected] = useState<string[]>(preselect ? [preselect] : []);
  const [busy, setBusy] = useState<'' | 'refresh' | 'visual' | 'start'>('');
  const [tipHidden, setTipHidden] = useState(() => localStorage.getItem(TIP_KEY) === '1');

  useEffect(() => {
    if (!entry || entry.status === 'error') void fetchPhotos(occasionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occasionId]);

  const items = entry?.data?.items ?? [];
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, items.filter(t.test).length])) as Record<TabId, number>, [items]);
  const shown = useMemo(() => items.filter(TABS.find((t) => t.id === tab)!.test), [items, tab]);
  const byRef = useMemo(() => new Map(items.map((p) => [p.ref, p])), [items]);

  const toggle = (ref: string) =>
    setSelected((s) => {
      if (s.includes(ref)) return s.filter((r) => r !== ref);
      if (s.length >= MAX_START_PHOTOS) {
        useUi.getState().toast(`A card can start with up to ${MAX_START_PHOTOS} photos. You can add more in the editor.`, 'info');
        return s;
      }
      return [...s, ref];
    });

  const run = async (kind: 'refresh' | 'visual') => {
    setBusy(kind);
    try {
      await fetchPhotos(occasionId, kind === 'refresh' ? { refresh: true, visual: !!entry?.data?.signals.visual } : { visual: true, refresh: true });
    } finally {
      setBusy('');
    }
  };

  const start = async () => {
    const picks = selected.map((r) => byRef.get(r)).filter((p): p is HolidayPhotoMatch => !!p);
    if (!picks.length) return;
    setBusy('start');
    try {
      await startCardWithPhotos(occasionId, picks);
      onClose();
    } catch (e: any) {
      useUi.getState().toast(e.message, 'error');
      setBusy('');
    }
  };

  const data = entry?.data;
  const needsTagRead = !!data?.missingScopes.includes('tag.read');
  const n = selected.length;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-5xl"
      bodyClass="p-0"
      title={`Pictures from this time · ${occ.name}`}
      subtitle={data ? signalsLine(data) : 'Looking through your Immich library (read-only)…'}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-[13px] text-ink-2">
            {n ? (
              <>
                {n} of {MAX_START_PHOTOS} selected
                <button className="text-ink-3 hover:text-ink hover:underline" onClick={() => setSelected([])}>
                  Clear
                </button>
              </>
            ) : (
              <span className="text-ink-3">Pick 1–{MAX_START_PHOTOS} photos to start a card.</span>
            )}
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!n || busy === 'start'} onClick={start}>
            {busy === 'start' ? <Spinner className="text-white" /> : <Sparkles size={15} />}
            {n ? `Start ${occ.name} card with ${n} selected photo${n === 1 ? '' : 's'}` : `Start ${occ.name} card`}
          </button>
        </>
      }
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-line bg-paper px-5 py-2.5">
        {TABS.map((t) => (
          <button key={t.id} className={clsx('chip', tab === t.id && 'chip-on')} onClick={() => setTab(t.id)} disabled={!data}>
            {t.label}
            {data && <span className="text-ink-3">{counts[t.id]}</span>}
          </button>
        ))}
        <div className="flex-1" />
        {data && !data.signals.visual && (
          <button className="btn btn-sm" disabled={!!busy} onClick={() => run('visual')} title="Ask Immich's visual search for photos that look like this holiday">
            {busy === 'visual' ? <Spinner size={13} /> : <Sparkles size={13} />} Search by visual theme
          </button>
        )}
        <button className="btn btn-sm" disabled={!!busy || !data} onClick={() => run('refresh')} title={data ? `Found ${new Date(data.generatedAt).toLocaleTimeString()}${data.cached ? ' (saved for 15 minutes)' : ''}` : undefined}>
          {busy === 'refresh' ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      <div className="px-5 py-4">
        {needsTagRead && !tipHidden && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-paper-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
            <Info size={16} className="mt-0.5 shrink-0 text-brand" />
            <div className="flex-1">
              <span className="font-medium text-ink">Tag matching is off.</span> Your Immich API key doesn’t include the optional <code className="rounded bg-white px-1">tag.read</code>{' '}
              permission, so photos you tagged “{occ.name}” aren’t searched. Add <code className="rounded bg-white px-1">tag.read</code> to a read-only key in Immich (Account Settings → API
              Keys), then save it under{' '}
              <button className="font-medium text-brand hover:underline" onClick={() => useUi.getState().openSettings('immich')}>
                Settings → Immich
              </button>
              . Dates, albums and favorites still work without it.
            </div>
            <button
              className="icon-btn h-6 w-6"
              aria-label="Dismiss tip"
              onClick={() => {
                localStorage.setItem(TIP_KEY, '1');
                setTipHidden(true);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {!data && entry?.status !== 'error' ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-paper-2" />
            ))}
          </div>
        ) : !data ? (
          <Empty title="Couldn’t reach Immich">
            {entry?.error}
            <div className="mt-3">
              <button className="btn btn-sm" onClick={() => void fetchPhotos(occasionId, { refresh: true })}>
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          </Empty>
        ) : !shown.length ? (
          <Empty title={tab === 'all' ? 'No photos from this time yet' : 'Nothing in this view'}>
            {tab === 'all'
              ? 'Nothing was taken around this date in past years or in the last few weeks. Try a visual search, or tag photos in Immich and add the tag name under Settings → Holidays.'
              : 'Try “All matches”.'}
          </Empty>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {shown.map((p) => {
              const at = selected.indexOf(p.ref);
              const on = at >= 0;
              return (
                <button
                  key={p.ref}
                  onClick={() => toggle(p.ref)}
                  aria-pressed={on}
                  title={[p.name, ...p.reasons].join('\n')}
                  className={clsx('group relative aspect-square overflow-hidden rounded-lg bg-paper-2 outline-none transition focus-visible:ring-2 focus-visible:ring-brand', on && 'ring-[3px] ring-brand ring-offset-2 ring-offset-paper')}
                >
                  <img src={p.thumbUrl} alt="" loading="lazy" className={clsx('h-full w-full object-cover transition', on ? 'scale-95 rounded-md' : 'group-hover:scale-105')} />
                  <span
                    className={clsx(
                      'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition',
                      on ? 'border-brand bg-brand text-white' : 'border-white/90 bg-black/20 text-transparent opacity-0 group-hover:opacity-100',
                    )}
                  >
                    {on ? at + 1 : <Check size={12} />}
                  </span>
                  {p.favorite && <Heart size={14} className="absolute left-1.5 top-1.5 fill-white text-white drop-shadow" />}
                  <span className="absolute inset-x-1 bottom-1 flex flex-wrap gap-1">
                    {p.reasons.slice(0, 2).map((r) => (
                      <span key={r} className="max-w-full truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        {r}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
