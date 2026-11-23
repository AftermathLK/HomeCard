/**
 * Short-lived, per-user memory cache for holiday photo suggestions. Keys always start with the
 * user id, so one person's results are never served to another, and changing your Immich key or
 * your own tag names drops everything you had cached.
 */

export const PHOTO_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 500;

const entries = new Map<string, { at: number; value: unknown }>();

const keyOf = (userId: string, parts: string[]) => [userId, ...parts].join('\u0000');

export function cachedPhotos<T>(userId: string, parts: string[], now = Date.now()): { value: T; at: number } | null {
  const k = keyOf(userId, parts);
  const e = entries.get(k);
  if (!e) return null;
  if (now - e.at > PHOTO_CACHE_TTL_MS) {
    entries.delete(k);
    return null;
  }
  return { value: e.value as T, at: e.at };
}

export function storePhotos(userId: string, parts: string[], value: unknown, now = Date.now()) {
  if (entries.size >= MAX_ENTRIES) {
    // Drop the oldest entry (Map keeps insertion order).
    const first = entries.keys().next().value;
    if (first !== undefined) entries.delete(first);
  }
  const k = keyOf(userId, parts);
  entries.delete(k);
  entries.set(k, { at: now, value });
}

/** Forget everything cached for one user (new Immich key, removed key, or new custom tags). */
export function invalidateUserPhotos(userId: string) {
  const prefix = `${userId}\u0000`;
  for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
}
