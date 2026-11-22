import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { LibraryListing, PhotoItem } from '@homecard/shared';
import { config } from '../config';
import { emit } from '../events';
import { userOf, type Actor } from '../auth/context';
import { IMAGE_EXT } from '../media/sources';
import { sharedPhotosDir, userPhotosDir, userUploadsDir } from '../storage/paths';
import { ensureDir, exists, httpError, isInside, safeJoin, sanitizeFileName, toPosix, uniquePath } from '../util/fsx';

/**
 * Local photos, as three virtual roots (the folder browser never sees real server paths):
 *   shared/…   → /data/photos/shared            (every signed-in user)
 *   mine/…     → /data/photos/users/<username>  (only you)
 *   uploads/…  → /data/uploads/<userId>         (photos you uploaded in the browser; only you)
 * Anything else under /data/photos is not reachable from the app.
 */

const PAGE = 120;
type RootId = 'shared' | 'mine' | 'uploads';
const ROOT_LABEL: Record<RootId, string> = { shared: 'Shared photos', mine: 'My photos', uploads: 'My uploads' };

function rootDir(root: RootId, me: Actor) {
  return root === 'shared' ? sharedPhotosDir() : root === 'mine' ? userPhotosDir(me.username) : userUploadsDir(me.userId);
}

/** Virtual "<root>/<sub>" → photo ref understood by the media routes. */
function refFor(root: RootId, sub: string, me: Actor) {
  if (root === 'shared') return `library:shared/${sub}`;
  if (root === 'mine') return `library:users/${me.username}/${sub}`;
  return `upload:${sub}`;
}

function itemFor(ref: string, mtime?: Date): PhotoItem {
  const enc = encodeURIComponent(ref);
  return { ref, name: path.basename(ref), thumbUrl: `/api/media/thumb?ref=${enc}`, previewUrl: `/api/media/preview?ref=${enc}`, takenAt: mtime?.toISOString() ?? null };
}

const hidden = (name: string) => name.startsWith('.') || name.startsWith('@') || name === '#recycle' || name === 'Thumbs.db';

function splitVirtual(p: string): { root: RootId; sub: string } | null {
  const clean = String(p ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean) return null;
  const [root, ...rest] = clean.split('/');
  if (root !== 'shared' && root !== 'mine' && root !== 'uploads') throw httpError(404, 'Folder not found');
  return { root, sub: rest.join('/') };
}

/** Resolve a folder inside a root with symlink protection. */
async function realDir(root: string, sub: string) {
  const abs = safeJoin(root, sub);
  const [rr, ra] = await Promise.all([fsp.realpath(root).catch(() => null), fsp.realpath(abs).catch(() => null)]);
  if (!rr || !ra || !isInside(rr, ra)) throw httpError(404, 'Folder not found');
  return ra;
}

const recentCache = new Map<string, { at: number; items: Array<{ ref: string; mtime: Date }> }>();

async function recentPhotos(me: Actor, limit = 4000) {
  const hit = recentCache.get(me.userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.items;
  const out: Array<{ ref: string; mtime: Date }> = [];
  let scanned = 0;
  for (const root of ['mine', 'uploads', 'shared'] as RootId[]) {
    const base = rootDir(root, me);
    const realBase = await fsp.realpath(base).catch(() => null);
    if (!realBase) continue;
    const walk = async (dir: string, depth: number) => {
      if (depth > 8 || scanned > 20000) return;
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (hidden(e.name)) continue;
        const abs = path.join(dir, e.name);
        // Only real files and folders: symlinks are not followed.
        if (e.isDirectory()) await walk(abs, depth + 1);
        else if (e.isFile() && IMAGE_EXT.test(e.name)) {
          scanned++;
          const st = await fsp.stat(abs).catch(() => null);
          if (st) out.push({ ref: refFor(root, toPosix(path.relative(realBase, abs)), me), mtime: st.mtime });
        }
      }
    };
    await walk(realBase, 0);
  }
  out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const items = out.slice(0, limit);
  recentCache.set(me.userId, { at: Date.now(), items });
  return items;
}

export function invalidateLibrary() {
  recentCache.clear();
}

export function registerLibraryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { path?: string; page?: string } }>('/api/library', async (req): Promise<LibraryListing> => {
    const me = userOf(req);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const v = splitVirtual(String(req.query.path ?? ''));
    if (!v) {
      // Top level: the three roots.
      const folders = [];
      for (const root of ['mine', 'uploads', 'shared'] as RootId[]) {
        const dir = rootDir(root, me);
        const kids = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
        const count = kids.filter((k) => k.isFile() && IMAGE_EXT.test(k.name)).length;
        if (root !== 'uploads' && !(await exists(dir))) continue;
        folders.push({ path: root, name: ROOT_LABEL[root], count });
      }
      return { path: '', folders, items: [], nextPage: null, total: 0 };
    }
    const base = rootDir(v.root, me);
    if (!(await exists(base))) {
      if (v.root === 'uploads' && !v.sub) return { path: v.root, folders: [], items: [], nextPage: null, total: 0 };
      throw httpError(404, 'Folder not found');
    }
    const abs = await realDir(base, v.sub);
    const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => {
      throw httpError(404, 'Folder not found');
    });
    const folders = [];
    const files: Array<{ sub: string; mtime: Date }> = [];
    for (const e of entries) {
      if (hidden(e.name)) continue;
      const childSub = v.sub ? `${v.sub}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const kids = await fsp.readdir(path.join(abs, e.name), { withFileTypes: true }).catch(() => []);
        folders.push({ path: `${v.root}/${childSub}`, name: e.name, count: kids.filter((k) => k.isFile() && IMAGE_EXT.test(k.name)).length });
      } else if (e.isFile() && IMAGE_EXT.test(e.name)) {
        const st = await fsp.stat(path.join(abs, e.name)).catch(() => null);
        files.push({ sub: childSub, mtime: st?.mtime ?? new Date(0) });
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const slice = files.slice((page - 1) * PAGE, page * PAGE);
    return {
      path: v.sub ? `${v.root}/${v.sub}` : v.root,
      folders,
      items: slice.map((f) => itemFor(refFor(v.root, f.sub, me), f.mtime)),
      nextPage: page * PAGE < files.length ? String(page + 1) : null,
      total: files.length,
    };
  });

  app.get<{ Querystring: { page?: string } }>('/api/library/recent', async (req) => {
    const me = userOf(req);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const all = await recentPhotos(me);
    const slice = all.slice((page - 1) * PAGE, page * PAGE);
    return { items: slice.map((f) => itemFor(f.ref, f.mtime)), nextPage: page * PAGE < all.length ? String(page + 1) : null, total: all.length };
  });

  app.post('/api/library/refresh', async (req) => {
    userOf(req);
    invalidateLibrary();
    return { ok: true };
  });

  /** Browser uploads land in /data/uploads/<userId>/<yyyy-mm>/ — private to the uploader. */
  app.post('/api/uploads', async (req) => {
    const me = userOf(req);
    const now = new Date();
    const sub = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dir = safeJoin(userUploadsDir(me.userId), sub);
    await ensureDir(dir);
    const items: PhotoItem[] = [];
    const rejected: string[] = [];
    for await (const part of req.files({ limits: { fileSize: config.maxUploadMB * 1024 * 1024 } })) {
      const name = sanitizeFileName(part.filename);
      if (!IMAGE_EXT.test(name)) {
        rejected.push(part.filename);
        part.file.resume();
        continue;
      }
      const dest = await uniquePath(dir, name);
      await pipeline(part.file, createWriteStream(dest, { mode: 0o640 }));
      if ((part.file as any).truncated) {
        await fsp.unlink(dest).catch(() => {});
        rejected.push(`${part.filename} (too large)`);
        continue;
      }
      items.push(itemFor(`upload:${sub}/${path.basename(dest)}`, now));
    }
    recentCache.delete(me.userId);
    return { items, rejected };
  });
}

/** Watcher hook: shared library changes reach everyone (no paths are sent). */
export function libraryChanged() {
  invalidateLibrary();
  emit('library', {});
}
