import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, EyeOff, Images, MoreHorizontal, Plus, Settings2 } from 'lucide-react';
import {
  countdownLine,
  dayPill,
  getOccasion,
  leadTimeNote,
  localIsoDay,
  upcomingHolidays,
  type HolidayOccurrence,
} from '@homecard/shared';
import { OccasionGlyph } from '@/components/MiniCard';
import { useAssets } from '@/lib/assets';
import { useHolidays } from '@/store/holidays';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';
import { HolidayPhotosDrawer } from './HolidayPhotosDrawer';
import { ensureHolidayPhotos, useHolidayPhotos } from './holidayPhotos';

const STRIP = 6;

/** "Welcome back" plus the next holiday worth making a card for, with photos from this time. */
export function UpcomingHero() {
  const prefs = useHolidays((s) => s.prefs);
  const loaded = useHolidays((s) => s.loaded);
  const name = useSession((s) => s.user?.displayName ?? '');
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  const immich = useAssets((s) => s.health?.immich);
  const [today, setToday] = useState(() => localIsoDay());
  const [picked, setPicked] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState<{ preselect?: string } | null>(null);

  // Roll over at midnight without a reload.
  useEffect(() => {
    const t = setInterval(() => setToday(localIsoDay()), 60_000);
    return () => clearInterval(t);
  }, []);

  const up = useMemo(
    () => upcomingHolidays(today, { hidden: prefs.hiddenOccasions, lookaheadDays: prefs.lookaheadDays, others: 3 }),
    [today, prefs.hiddenOccasions, prefs.lookaheadDays],
  );
  const list = useMemo(() => (up.primary ? [up.primary, ...up.others] : []), [up]);
  const index = Math.max(0, list.findIndex((o) => o.occasionId === picked));
  const current: HolidayOccurrence | undefined = list[index];
  const linked = !!immich?.linked;

  useEffect(() => {
    if (current && linked && prefs.showHomeBanner) ensureHolidayPhotos(current.occasionId);
  }, [current?.occasionId, linked, prefs.showHomeBanner]);
  const entry = useHolidayPhotos((s) => (current ? s.entries[current.occasionId] : undefined));

  if (!loaded || !prefs.showHomeBanner || !current) return null;

  const occ = getOccasion(current.occasionId);
  const pal = occ.palettes[0].colors;
  const strip = entry?.data?.items.slice(0, STRIP) ?? [];
  const go = (dir: -1 | 1) => setPicked(list[(index + dir + list.length) % list.length].occasionId);
  const plan = () => useUi.getState().set({ newCardOpen: true, newCardOccasionId: current.occasionId });

  return (
    <section aria-label="Upcoming holiday" className="mb-6 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div
        className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center"
        style={{ background: `linear-gradient(100deg, color-mix(in srgb, ${pal.background} 38%, white) 0%, white 62%)` }}
      >
        <div className="flex min-w-0 flex-1 gap-4">
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl shadow-sm"
            style={{ background: pal.background, color: pal.accent, ['--hc-orn2' as any]: pal.accent2 }}
          >
            <OccasionGlyph occasionId={occ.id} size={38} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink-3">{name ? `Welcome back, ${name}` : 'Welcome back'}</p>
            <h2 className="mt-0.5 font-display text-[26px] leading-tight text-ink">{countdownLine(current)}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ background: pal.background, color: pal.text }}>
                <CalendarDays size={13} /> {dayPill(current)}
              </span>
              <span className="text-[12.5px] text-ink-2">{leadTimeNote(current.daysAway)}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={plan}>
                <Plus size={15} /> Plan a {occ.name} card
              </button>
              {linked ? (
                <button className="btn" onClick={() => setDrawer({})}>
                  <Images size={15} /> See pictures from this time
                </button>
              ) : immich?.serverConfigured || isAdmin ? (
                <button className="text-[13px] font-medium text-brand hover:underline" onClick={() => useUi.getState().openSettings(immich?.serverConfigured ? 'immich' : 'server')}>
                  Connect Immich to see photos from this time
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {linked && (
          <div className="shrink-0 lg:w-[312px]">
            {entry?.status === 'loading' && !strip.length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: STRIP }, (_, i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-lg bg-paper-2" />
                ))}
              </div>
            ) : strip.length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {strip.map((p) => (
                  <button
                    key={p.ref}
                    onClick={() => setDrawer({ preselect: p.ref })}
                    title={p.reasons.join(' · ')}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-paper-2 outline-none ring-brand focus-visible:ring-2"
                  >
                    <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                  </button>
                ))}
              </div>
            ) : entry?.status === 'error' ? (
              <p className="rounded-lg bg-paper-2 px-3 py-2 text-[12px] text-ink-3">Couldn’t reach Immich for photos: {entry.error}</p>
            ) : entry?.status === 'ready' ? (
              <p className="rounded-lg bg-paper-2 px-3 py-2 text-[12px] text-ink-3">No photos from this time of year yet. Try a visual search from “See pictures”.</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper/60 px-5 py-2">
        {list.length > 1 && (
          <>
            <button className="icon-btn h-7 w-7" aria-label="Previous holiday" onClick={() => go(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button className="icon-btn h-7 w-7" aria-label="Next holiday" onClick={() => go(1)}>
              <ChevronRight size={16} />
            </button>
            <span className="ml-1 text-[12px] text-ink-3">Also coming up</span>
            {list.map((o, i) =>
              i === index ? null : (
                <button key={o.occasionId} className="chip" onClick={() => setPicked(o.occasionId)}>
                  {getOccasion(o.occasionId).name}
                  <span className="text-ink-3">· {o.ongoing ? 'today' : o.daysAway === 1 ? 'tomorrow' : `${o.daysAway} days`}</span>
                </button>
              ),
            )}
          </>
        )}
        <div className="flex-1" />
        <div className="relative">
          <button className="icon-btn h-7 w-7" aria-label="Holiday options" onClick={() => setMenu((v) => !v)} onBlur={() => setTimeout(() => setMenu(false), 150)}>
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className="absolute bottom-9 right-0 z-20 w-56 rounded-xl border border-line bg-white p-1 shadow-pop">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-paper-2"
                onClick={() => {
                  setPicked(null);
                  void useHolidays.getState().hide(occ.id);
                }}
              >
                <EyeOff size={14} /> Hide {occ.name}
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-paper-2" onClick={() => useUi.getState().openSettings('holidays')}>
                <Settings2 size={14} /> Holiday settings…
              </button>
            </div>
          )}
        </div>
      </div>

      {drawer && <HolidayPhotosDrawer occasionId={occ.id} preselect={drawer.preselect} onClose={() => setDrawer(null)} />}
    </section>
  );
}

/** Small helper for places that only need the featured holiday (e.g. the New card default). */
export function featuredHolidayId(): string | null {
  const { prefs } = useHolidays.getState();
  return upcomingHolidays(localIsoDay(), { hidden: prefs.hiddenOccasions, lookaheadDays: prefs.lookaheadDays, others: 0 }).primary?.occasionId ?? null;
}
