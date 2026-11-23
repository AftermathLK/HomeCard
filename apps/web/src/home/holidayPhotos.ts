import { create } from 'zustand';
import type { UpcomingPhotosDto } from '@homecard/shared';
import { api, enc } from '@/lib/api';

/**
 * "Pictures from this time" per occasion, shared by the home strip and the drawer so both use one
 * request. The server keeps its own 15-minute cache per person; Refresh skips it.
 */
export interface HolidayPhotosEntry {
  status: 'loading' | 'ready' | 'error';
  data?: UpcomingPhotosDto;
  error?: string;
}

interface HolidayPhotosState {
  entries: Record<string, HolidayPhotosEntry>;
  fetch: (occasionId: string, opts?: { refresh?: boolean; visual?: boolean }) => Promise<void>;
  reset: () => void;
}

const inFlight = new Map<string, Promise<void>>();

export const useHolidayPhotos = create<HolidayPhotosState>((set, get) => ({
  entries: {},
  fetch(occasionId, opts = {}) {
    const key = `${occasionId}:${opts.visual ? 'v' : ''}:${opts.refresh ? 'r' : ''}`;
    const running = inFlight.get(key);
    if (running) return running;
    const prev = get().entries[occasionId];
    // Keep showing what we had while a refresh or visual search runs.
    set((s) => ({ entries: { ...s.entries, [occasionId]: { ...prev, status: prev?.data ? 'ready' : 'loading', error: undefined } } }));
    const q = `occasionId=${enc(occasionId)}${opts.visual ? '&visual=1' : ''}${opts.refresh ? '&refresh=1' : ''}`;
    const job = api
      .get<UpcomingPhotosDto>(`/api/immich/upcoming-photos?${q}`)
      .then(
        (data) => set((s) => ({ entries: { ...s.entries, [occasionId]: { status: 'ready', data } } })),
        (e: Error) => set((s) => ({ entries: { ...s.entries, [occasionId]: { ...s.entries[occasionId], status: prev?.data ? 'ready' : 'error', error: e.message } } })),
      )
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
    return job;
  },
  reset: () => set({ entries: {} }),
}));

/** Load an occasion's suggestions once (no-op when already loaded or loading). */
export function ensureHolidayPhotos(occasionId: string) {
  const e = useHolidayPhotos.getState().entries[occasionId];
  if (e && (e.status === 'ready' || e.status === 'loading')) return;
  void useHolidayPhotos.getState().fetch(occasionId);
}
