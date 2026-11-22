import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { exists, httpError } from '../util/fsx';

/**
 * Per-user storage layout:
 *   /data/projects/<userId>/<projectId>/…     drafts, versions, thumbnails
 *   /data/uploads/<userId>/<yyyy-mm>/…        photos uploaded in the browser
 *   /data/exports/<userId>/<card>/<stamp>/…   finished print files
 *   /data/cache/users/<userId>/…              private derivatives (Immich thumbnails/previews)
 * Shared by everyone: /data/fonts, /data/styles, /data/photos/shared.
 * Private mounted photos: /data/photos/users/<username>.
 */

export const USER_ID_RE = /^u_[0-9a-f]{18}$/;

export function assertUserId(id: string) {
  if (!USER_ID_RE.test(id)) throw httpError(400, 'Invalid user id');
  return id;
}

export const userProjectsDir = (userId: string) => path.join(config.dirs.projects, assertUserId(userId));
export const userUploadsDir = (userId: string) => path.join(config.dirs.uploads, assertUserId(userId));
export const userExportsDir = (userId: string) => path.join(config.dirs.exports, assertUserId(userId));
export const userCacheDir = (userId: string) => path.join(config.dirs.cache, 'users', assertUserId(userId));
/** Cache bucket name for util/cache (relative to /data/cache). */
export const userCacheBucket = (userId: string, bucket: string) => `users/${assertUserId(userId)}/${bucket}`;

export const sharedPhotosDir = () => path.join(config.dirs.photos, 'shared');
export const userPhotosDir = (username: string) => path.join(config.dirs.photos, 'users', username);

const TRASH = '.trash';
const TRASH_DAYS = 30;

/** Move a deleted user's projects, uploads and exports to each root's .trash (purged after 30 days). */
export async function archiveUserData(userId: string) {
  const stamp = Date.now();
  const moved: string[] = [];
  for (const [root, dir] of [
    [config.dirs.projects, userProjectsDir(userId)],
    [config.dirs.uploads, userUploadsDir(userId)],
    [config.dirs.exports, userExportsDir(userId)],
  ] as const) {
    if (!(await exists(dir))) continue;
    const trash = path.join(root, TRASH);
    await fsp.mkdir(trash, { recursive: true });
    await fsp.rename(dir, path.join(trash, `user-${userId}-${stamp}`));
    moved.push(path.basename(root));
  }
  await fsp.rm(userCacheDir(userId), { recursive: true, force: true }).catch(() => {});
  return moved;
}

/** Permanently remove trash entries older than 30 days (projects, uploads, exports). */
export async function purgeDataTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 86_400_000;
  for (const root of [config.dirs.projects, config.dirs.uploads, config.dirs.exports]) {
    const trash = path.join(root, TRASH);
    for (const e of await fsp.readdir(trash).catch(() => [] as string[])) {
      const t = Number(e.split('-').pop());
      if (t && t < cutoff) await fsp.rm(path.join(trash, e), { recursive: true, force: true }).catch(() => {});
    }
  }
}
