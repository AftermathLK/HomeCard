import {
  addDays,
  getOccasion,
  HOLIDAY_KEYWORDS,
  HOLIDAY_VISUAL_QUERY,
  keywordStrength,
  localIsoDay,
  matchesCustomTag,
  nextOccurrence,
  pastWindows,
  type HolidayPhotoMatch,
  type PhotoMatchKind,
  type UpcomingPhotosDto,
} from '@homecard/shared';
import { assetToItem, type ImmichAsset, type SearchResponse } from './assets';
import type { ReadOnlyImmichClient } from './readonly';

/**
 * "See pictures from this time": photos from the signed-in person's OWN Immich library that suit
 * an occasion, found with read-only requests only (GET tag/album lists, POST search):
 *   1. Immich tags whose name or path matches the holiday ("Holidays/Christmas", "xmas") or the
 *      person's own tag names for it (needs the optional tag.read permission)
 *   2. the same time in each of the past 4 years (±14 days around that year's real date)
 *   3. the last 45 days, favourites first (recent photos often go on the next card)
 *   4. albums whose title matches the holiday
 *   5. Immich's visual (CLIP) search, when the rest finds fewer than 8 or the person asks
 * Results are merged by asset id; each photo says why it was picked.
 */

export interface ImmichTag {
  id: string;
  name: string;
  value?: string;
}

interface ImmichAlbumRow {
  id: string;
  albumName: string;
  assetCount?: number;
}

export interface DiscoverOptions {
  occasionId: string;
  /** The person's own Immich tag names for this occasion. */
  customTags?: readonly string[];
  /** Run visual search even when the other signals found plenty. */
  visual?: boolean;
  /** The key's verified permissions; null when they couldn't be read (then tags are simply tried). */
  permissions?: readonly string[] | null;
  now?: Date;
}

export const RECENT_DAYS = 45;
const PAST_YEARS = 4;
const PAD_DAYS = 14;
const PER_QUERY = 40;
const MAX_TAGS = 6;
const MAX_ALBUMS = 3;
const MAX_ITEMS = 150;
/** Room each kind of match is guaranteed inside MAX_ITEMS (5 kinds × 20 leaves 50 for the best of the rest). */
const KEEP_PER_KIND = 20;
const SMART_BELOW = 8;

/** Weight of each signal in the ranking (a photo found several ways adds them up). */
const WEIGHT: Record<PhotoMatchKind, number> = { tag: 5, album: 4, past: 3, smart: 2, recent: 1 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso?: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : 'This time of year';
};

/** Archived, hidden, locked and trashed photos are never suggested. */
export function isSuggestable(a: ImmichAsset): boolean {
  if (a.type !== 'IMAGE' || a.isTrashed || a.isArchived) return false;
  return !a.visibility || a.visibility === 'timeline';
}

/** Run async jobs a few at a time so one discovery never floods the Immich server. */
async function pool<T>(jobs: Array<() => Promise<T>>, size = 6): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

const statusOf = (e: unknown) => Number((e as { statusCode?: number })?.statusCode ?? 0);

export async function discoverHolidayPhotos(c: ReadOnlyImmichClient, opts: DiscoverOptions): Promise<Omit<UpcomingPhotosDto, 'cached'>> {
  const occ = getOccasion(opts.occasionId);
  const now = opts.now ?? new Date();
  const today = localIsoDay(now);
  const occurrence = nextOccurrence(occ.id, today);
  const keywords = HOLIDAY_KEYWORDS[occ.id] ?? [];
  const custom = opts.customTags ?? [];
  const missingScopes = new Set<string>();
  const errors: unknown[] = [];

  const found = new Map<string, { asset: ImmichAsset; reasons: Map<string, number>; kinds: Set<PhotoMatchKind> }>();
  const add = (assets: ImmichAsset[], kind: PhotoMatchKind, reason: (a: ImmichAsset) => string, weight = WEIGHT[kind]) => {
    for (const a of assets) {
      if (!isSuggestable(a)) continue;
      const f = found.get(a.id) ?? { asset: a, reasons: new Map(), kinds: new Set() };
      f.kinds.add(kind);
      const r = reason(a);
      f.reasons.set(r, Math.max(f.reasons.get(r) ?? 0, weight));
      found.set(a.id, f);
    }
  };
  const metadata = (body: Record<string, unknown>) =>
    c.search<SearchResponse>('metadata', { type: 'IMAGE', withExif: true, order: 'desc', size: PER_QUERY, page: 1, ...body }).then(
      (r) => r.assets.items,
      (e) => {
        errors.push(e);
        return [] as ImmichAsset[];
      },
    );

  // 1 + 4: tag and album lists (both cheap), in parallel.
  const tagsAllowed = !opts.permissions || opts.permissions.includes('tag.read');
  if (!tagsAllowed) missingScopes.add('tag.read');
  const [tags, albums] = await Promise.all([
    tagsAllowed && (keywords.length || custom.length)
      ? c.get<ImmichTag[]>('/api/tags').catch((e) => {
          // 403: the key lacks tag.read. 404/400: an Immich without tags. Either way, carry on without them.
          if (statusOf(e) === 403) missingScopes.add('tag.read');
          else if (statusOf(e) !== 404 && statusOf(e) !== 400) errors.push(e);
          return [] as ImmichTag[];
        })
      : Promise.resolve([] as ImmichTag[]),
    keywords.length
      ? Promise.all([c.get<ImmichAlbumRow[]>('/api/albums'), c.get<ImmichAlbumRow[]>('/api/albums?shared=true').catch(() => [] as ImmichAlbumRow[])]).then(
          ([own, shared]) => [...own, ...shared],
          (e) => {
            errors.push(e);
            return [] as ImmichAlbumRow[];
          },
        )
      : Promise.resolve([] as ImmichAlbumRow[]),
  ]);

  // The person's own tag names first, then built-in keywords by strength.
  const matchedTags = (Array.isArray(tags) ? tags : [])
    .map((t) => ({ t, mine: matchesCustomTag(t, custom), s: keywordStrength(t.value ?? t.name, keywords) }))
    .filter((x) => x.mine || x.s >= 0)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.s - b.s)
    .slice(0, MAX_TAGS)
    .map((x) => x.t);
  const seenAlbum = new Set<string>();
  const matchedAlbums = (Array.isArray(albums) ? albums : [])
    .filter((a) => (seenAlbum.has(a.id) ? false : (seenAlbum.add(a.id), true)))
    .map((a) => ({ a, s: keywordStrength(a.albumName, keywords) }))
    .filter((x) => x.s >= 0 && (x.a.assetCount ?? 1) > 0)
    .sort((x, y) => x.s - y.s || (y.a.assetCount ?? 0) - (x.a.assetCount ?? 0))
    .slice(0, MAX_ALBUMS)
    .map((x) => x.a);

  const windows = occurrence ? pastWindows(occ.id, occurrence, PAST_YEARS, PAD_DAYS) : [];
  const recentFrom = addDays(today, -RECENT_DAYS);
  const dayStart = (d: string) => `${d}T00:00:00.000Z`;

  const jobs: Array<() => Promise<void>> = [
    ...matchedTags.map((t) => async () => {
      const label = `Tag: ${(t.value ?? t.name).split('/').pop() || t.name}`;
      add(await metadata({ tagIds: [t.id] }), 'tag', () => label, matchesCustomTag(t, custom) ? WEIGHT.tag + 1 : WEIGHT.tag);
    }),
    ...windows.map((w) => async () => {
      add(await metadata({ takenAfter: dayStart(w.from), takenBefore: dayStart(addDays(w.to, 1)) }), 'past', (a) => monthLabel(a.localDateTime ?? a.fileCreatedAt));
    }),
    async () => add(await metadata({ takenAfter: dayStart(recentFrom), isFavorite: true }), 'recent', () => 'Recent favorite', WEIGHT.recent + 2),
    async () => add(await metadata({ takenAfter: dayStart(recentFrom) }), 'recent', () => 'Recent'),
    ...matchedAlbums.map((al) => async () => {
      let assets = await metadata({ albumIds: [al.id] });
      if (!assets.length) {
        // Older Immich: no albumIds in search; read the album itself.
        const full = await c.get<{ assets?: ImmichAsset[] }>(`/api/albums/${al.id}?withoutAssets=false`).catch(() => null);
        assets = (full?.assets ?? []).slice(0, PER_QUERY);
      }
      add(assets, 'album', () => `Album: ${al.albumName}`);
    }),
  ];
  await pool(jobs);

  let visual = false;
  if (opts.visual || found.size < SMART_BELOW) {
    const query = HOLIDAY_VISUAL_QUERY[occ.id] ?? occ.name;
    try {
      const r = await c.search<SearchResponse>('smart', { query, type: 'IMAGE', size: PER_QUERY, page: 1, withExif: true });
      add(r.assets.items, 'smart', () => 'Visual match');
      visual = true;
    } catch {
      // Smart search off (no machine learning on this Immich): the other signals stand.
    }
  }

  // Nothing at all came back and something failed: report it instead of an empty, cheerful drawer.
  if (!found.size && errors.length) throw errors[0];

  const ranked = [...found.values()]
    .map((f) => {
      const reasons = [...f.reasons.entries()].sort((a, b) => b[1] - a[1]);
      const score = reasons.reduce((n, [, w]) => n + w, 0) + (f.asset.isFavorite ? 1 : 0);
      return { f, reasons: reasons.map(([r]) => r), score };
    })
    .sort((a, b) => b.score - a.score || String(b.f.asset.localDateTime ?? b.f.asset.fileCreatedAt ?? '').localeCompare(String(a.f.asset.localDateTime ?? a.f.asset.fileCreatedAt ?? '')));
  // Every signal keeps its best few, so in a big library four busy past-year windows can't
  // crowd recent photos (or visual matches) out of the list; the rest of the room goes by score.
  const keep = new Set<string>();
  for (const kind of Object.keys(WEIGHT) as PhotoMatchKind[]) {
    for (const x of ranked.filter((r) => r.f.kinds.has(kind)).slice(0, KEEP_PER_KIND)) keep.add(x.f.asset.id);
  }
  for (const x of ranked) {
    if (keep.size >= MAX_ITEMS) break;
    keep.add(x.f.asset.id);
  }
  const items: HolidayPhotoMatch[] = ranked
    .filter((x) => keep.has(x.f.asset.id))
    .map(({ f, reasons }) => ({ ...assetToItem(f.asset), reasons, kinds: [...f.kinds] }));

  return {
    occasionId: occ.id,
    date: occurrence?.date ?? null,
    items,
    missingScopes: [...missingScopes],
    signals: {
      tags: matchedTags.map((t) => (t.value ?? t.name).split('/').pop() || t.name),
      albums: matchedAlbums.map((a) => a.albumName),
      pastYears: [...new Set(windows.map((w) => w.year))],
      recentDays: RECENT_DAYS,
      visual,
    },
    generatedAt: now.toISOString(),
  };
}

/** Tag list for the Settings autocomplete. Never throws for a missing tag.read. */
export async function listImmichTags(c: ReadOnlyImmichClient, permissions?: readonly string[] | null): Promise<{ available: boolean; tags: Array<{ name: string; value: string }>; missingScopes: string[] }> {
  if (permissions && !permissions.includes('tag.read')) return { available: false, tags: [], missingScopes: ['tag.read'] };
  try {
    const tags = await c.get<ImmichTag[]>('/api/tags');
    const list = (Array.isArray(tags) ? tags : []).map((t) => ({ name: t.name, value: t.value ?? t.name })).sort((a, b) => a.value.localeCompare(b.value));
    return { available: true, tags: list.slice(0, 2000), missingScopes: [] };
  } catch (e) {
    if (statusOf(e) === 403) return { available: false, tags: [], missingScopes: ['tag.read'] };
    if (statusOf(e) === 404 || statusOf(e) === 400) return { available: false, tags: [], missingScopes: [] };
    throw e;
  }
}
