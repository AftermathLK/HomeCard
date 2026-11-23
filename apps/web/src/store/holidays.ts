import { create } from 'zustand';
import { DEFAULT_HOLIDAY_PREFS, getOccasion, type HolidayPrefs } from '@homecard/shared';
import { api } from '@/lib/api';
import { useUi } from './ui';

/**
 * The signed-in person's holiday preferences (home banner, lookahead, hidden holidays, their own
 * Immich tag names). Saved per user on the server; changes show at once and roll back on error.
 */
interface HolidaysState {
  prefs: HolidayPrefs;
  loaded: boolean;
  load: (force?: boolean) => Promise<HolidayPrefs>;
  save: (patch: Partial<HolidayPrefs>) => Promise<void>;
  /** Hide one holiday everywhere (home banner, occasion picker), with an Undo toast. */
  hide: (occasionId: string) => Promise<void>;
  unhide: (occasionId: string) => Promise<void>;
}

const fresh = (): HolidayPrefs => ({ ...DEFAULT_HOLIDAY_PREFS, hiddenOccasions: [], customTagMap: {} });

let loading: Promise<HolidayPrefs> | null = null;
// Saves go out one after another, so a quick hide-then-undo can't land in the wrong order.
let queue: Promise<unknown> = Promise.resolve();

export const useHolidays = create<HolidaysState>((set, get) => ({
  prefs: fresh(),
  loaded: false,
  load(force = false) {
    if (get().loaded && !force) return Promise.resolve(get().prefs);
    if (loading && !force) return loading;
    loading = api
      .get<HolidayPrefs>('/api/me/holidays')
      .then((prefs) => {
        set({ prefs, loaded: true });
        return prefs;
      })
      .catch(() => {
        // Not fatal: the home page simply uses the defaults.
        set({ loaded: true });
        return get().prefs;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  },
  save(patch) {
    const before = get().prefs;
    set({ prefs: { ...before, ...patch } });
    const job = queue.then(() =>
      api.put<HolidayPrefs>('/api/me/holidays', patch).then(
        (prefs) => set({ prefs }),
        (e: Error) => {
          set({ prefs: before });
          useUi.getState().toast(`Couldn’t save holiday settings: ${e.message}`, 'error');
        },
      ),
    );
    queue = job;
    return job;
  },
  async hide(occasionId) {
    const hidden = get().prefs.hiddenOccasions;
    if (hidden.includes(occasionId)) return;
    await get().save({ hiddenOccasions: [...hidden, occasionId] });
    if (!get().prefs.hiddenOccasions.includes(occasionId)) return;
    useUi.getState().toast(`${getOccasion(occasionId).name} is hidden. You can reveal hidden holidays anytime in Settings → Holidays.`, 'info', {
      label: 'Undo',
      run: () => void get().unhide(occasionId),
    });
  },
  async unhide(occasionId) {
    const hidden = get().prefs.hiddenOccasions;
    if (!hidden.includes(occasionId)) return;
    await get().save({ hiddenOccasions: hidden.filter((id) => id !== occasionId) });
  },
}));
