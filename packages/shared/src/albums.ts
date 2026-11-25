/**
 * Immich albums in the photo picker: name search, sorting and per-person favourites.
 */
import type { ImmichAlbum } from './api';

export type AlbumSort = 'name-asc' | 'name-desc' | 'recent-photo' | 'created-desc' | 'created-asc' | 'photo-date-desc' | 'count-desc';

export const ALBUM_SORTS: ReadonlyArray<{ id: AlbumSort; label: string }> = [
  { id: 'name-asc', label: 'Title (A–Z)' },
  { id: 'name-desc', label: 'Title (Z–A)' },
  { id: 'recent-photo', label: 'Last photo added' },
  { id: 'created-desc', label: 'Newest album' },
  { id: 'created-asc', label: 'Oldest album' },
  { id: 'photo-date-desc', label: 'Most recent photos' },
  { id: 'count-desc', label: 'Most photos' },
];

export interface PickerPrefs {
  /** Immich album ids, in the order they were starred. */
  favoriteAlbums: string[];
  albumSort: AlbumSort;
}

export const DEFAULT_PICKER_PREFS: PickerPrefs = { favoriteAlbums: [], albumSort: 'name-asc' };
export const MAX_FAVORITE_ALBUMS = 200;

const ALBUM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Keep only well-formed values; anything missing or invalid comes from `base`. */
export function sanitizePickerPrefs(input: unknown, base: PickerPrefs = DEFAULT_PICKER_PREFS): PickerPrefs {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof PickerPrefs, unknown>>;
  const out: PickerPrefs = { favoriteAlbums: [...base.favoriteAlbums], albumSort: base.albumSort };
  if (Array.isArray(p.favoriteAlbums))
    out.favoriteAlbums = [...new Set(p.favoriteAlbums.filter((x): x is string => typeof x === 'string' && ALBUM_ID_RE.test(x)))].slice(0, MAX_FAVORITE_ALBUMS);
  if (ALBUM_SORTS.some((s) => s.id === p.albumSort)) out.albumSort = p.albumSort as AlbumSort;
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Does an album (or person) name match what was typed? Every word must appear, any order, accents ignored. */
export function nameMatches(name: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const n = fold(name);
  return words.every((w) => n.includes(w));
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return isFinite(t) ? t : null;
};

/** Sort a copy of the albums. Albums missing the date being sorted on go last, then by title. */
export function sortAlbums(albums: readonly ImmichAlbum[], sort: AlbumSort): ImmichAlbum[] {
  const byName = (a: ImmichAlbum, b: ImmichAlbum) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const byDate = (pick: (a: ImmichAlbum) => string | null | undefined, dir: 1 | -1) => (a: ImmichAlbum, b: ImmichAlbum) => {
    const ta = time(pick(a)), tb = time(pick(b));
    if (ta === null && tb === null) return byName(a, b);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return (ta - tb) * dir || byName(a, b);
  };
  const cmp: Record<AlbumSort, (a: ImmichAlbum, b: ImmichAlbum) => number> = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    'recent-photo': byDate((a) => a.lastAssetAt ?? a.updatedAt, -1),
    'created-desc': byDate((a) => a.createdAt, -1),
    'created-asc': byDate((a) => a.createdAt, 1),
    'photo-date-desc': byDate((a) => a.endDate, -1),
    'count-desc': (a, b) => b.count - a.count || byName(a, b),
  };
  return [...albums].sort(cmp[sort] ?? byName);
}
