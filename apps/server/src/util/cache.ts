import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { dirSize, ensureDir, exists, sha1, writeFileAtomic } from './fsx';

/** Simple content cache on disk: <cache>/<bucket>/<aa>/<hash>.<ext>. */
export function cachePath(bucket: string, key: string, ext: string) {
  const h = sha1(key);
  return path.join(config.dirs.cache, bucket, h.slice(0, 2), `${h}.${ext}`);
}

/**
 * A cached file, or null. With maxAgeMs the entry expires that long after it was written (reads
 * don't extend it), for data a provider only lets us keep for a while.
 */
export async function cacheGet(bucket: string, key: string, ext: string, opts: { maxAgeMs?: number } = {}): Promise<string | null> {
  const p = cachePath(bucket, key, ext);
  if (opts.maxAgeMs !== undefined) {
    const st = await fsp.stat(p).catch(() => null);
    if (!st) return null;
    if (Date.now() - st.mtimeMs <= opts.maxAgeMs) return p;
    await fsp.rm(p, { force: true });
    return null;
  }
  if (await exists(p)) {
    const now = new Date();
    fsp.utimes(p, now, now).catch(() => {});
    return p;
  }
  return null;
}

/** Delete every file in a cache bucket written more than maxAgeMs ago. */
export async function purgeCacheBucket(bucket: string, maxAgeMs: number) {
  const { files } = await dirSize(path.join(config.dirs.cache, bucket));
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const f of files) {
    const st = await fsp.stat(f.path).catch(() => null);
    if (st && st.mtimeMs < cutoff && (await fsp.rm(f.path, { force: true }).then(() => true, () => false))) removed++;
  }
  return removed;
}

export async function cachePut(bucket: string, key: string, ext: string, data: Buffer | Uint8Array | string) {
  const p = cachePath(bucket, key, ext);
  await writeFileAtomic(p, data);
  scheduleTrim();
  return p;
}

const inflight = new Map<string, Promise<any>>();
/** Deduplicate concurrent work for the same key. */
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

let trimTimer: NodeJS.Timeout | null = null;
function scheduleTrim() {
  if (trimTimer) return;
  trimTimer = setTimeout(async () => {
    trimTimer = null;
    await trimCache().catch(() => {});
  }, 60_000);
}

/** Evict least-recently-used files once the cache exceeds CACHE_MAX_MB. */
export async function trimCache() {
  await ensureDir(config.dirs.cache);
  const { bytes, files } = await dirSize(config.dirs.cache);
  if (bytes <= config.cacheMaxBytes) return { bytes, removed: 0 };
  files.sort((a, b) => a.atimeMs - b.atimeMs);
  let total = bytes, removed = 0;
  const target = config.cacheMaxBytes * 0.85;
  for (const f of files) {
    if (total <= target) break;
    if (f.path.includes(`${path.sep}faces${path.sep}`)) continue; // face data is tiny + precious
    await fsp.unlink(f.path).catch(() => {});
    total -= f.size;
    removed++;
  }
  return { bytes: total, removed };
}
