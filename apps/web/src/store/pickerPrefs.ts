import { create } from 'zustand';
import { DEFAULT_PICKER_PREFS, type AlbumSort, type PickerPrefs } from '@homecard/shared';
import { api } from '@/lib/api';
import { useUi } from './ui';

/**
 * The signed-in person's photo picker preferences: favourite Immich albums and the album sort.
 * Saved per user on the server (so they follow you to any device); changes show at once and
 * roll back on error.
 */
interface PickerPrefsState {
  prefs: PickerPrefs;
  /** Fetch from the server (the picker calls this each time it opens). */
  load: () => Promise<void>;
  save: (patch: Partial<PickerPrefs>) => Promise<void>;
  toggleFavorite: (albumId: string) => Promise<void>;
  setSort: (sort: AlbumSort) => Promise<void>;
}

const fresh = (): PickerPrefs => ({ ...DEFAULT_PICKER_PREFS, favoriteAlbums: [] });

// Saves go out one after another; only the newest reply is applied, so quick taps never flicker.
let queue: Promise<unknown> = Promise.resolve();
let latest = 0;

export const usePickerPrefs = create<PickerPrefsState>((set, get) => ({
  prefs: fresh(),
  async load() {
    const seq = latest;
    try {
      const prefs = await api.get<PickerPrefs>('/api/me/picker');
      if (seq === latest) set({ prefs });
    } catch {
      // Not fatal: the picker just shows albums by title, with no favourites.
    }
  },
  save(patch) {
    const before = get().prefs;
    const seq = ++latest;
    set({ prefs: { ...before, ...patch } });
    const job = queue.then(() =>
      api.put<PickerPrefs>('/api/me/picker', patch).then(
        (prefs) => {
          if (seq === latest) set({ prefs });
        },
        (e: Error) => {
          set({ prefs: before });
          useUi.getState().toast(`Couldn’t save album settings: ${e.message}`, 'error');
        },
      ),
    );
    queue = job;
    return job;
  },
  toggleFavorite(albumId) {
    const favs = get().prefs.favoriteAlbums;
    return get().save({ favoriteAlbums: favs.includes(albumId) ? favs.filter((id) => id !== albumId) : [...favs, albumId] });
  },
  setSort(albumSort) {
    return get().save({ albumSort });
  },
}));
