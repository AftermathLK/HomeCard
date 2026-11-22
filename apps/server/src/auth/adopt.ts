import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { normalizeImmichUrl } from '../immich/credentials';
import { reconcileProjects } from '../projects/store';
import { rescanExports } from '../render/exporter';
import { parsePrefs, updateUserFields, type UserRow } from '../security/users';
import { USER_ID_RE, userExportsDir, userProjectsDir, userUploadsDir } from '../storage/paths';
import { secureUnlink } from '../util/ephemeral';
import { ensureDir, exists, readJson, writeFileAtomic } from '../util/fsx';

/**
 * Upgrading from the early single-user builds (no accounts).
 *
 * At startup (migrateLegacyConfig):
 *   - settings.json: the Immich URL becomes the admin-managed server URL; the old shared Immich
 *     API key is securely deleted from disk (every person now links their own read-only key).
 *   - The old media cache mixed everyone's Immich thumbnails/previews in shared folders; it is
 *     wiped once (it's only derived data) so private photos can't linger there.
 *
 * When the first admin is created (adoptLegacyData):
 *   - /data/projects/<projectId>/  → /data/projects/<adminId>/<projectId>/
 *   - /data/exports/<card>/…       → /data/exports/<adminId>/<card>/…
 *   - /data/photos/uploads/…       → /data/uploads/<adminId>/…
 *   - photo references inside drafts are rewritten: library:uploads/x → upload:x, and old
 *     top-level library paths are pointed at photos/shared/ or photos/users/<admin>/ when the
 *     file has been moved there.
 */

const CACHE_LAYOUT = '2';

export async function migrateLegacyConfig(log: (m: string) => void) {
  const file = path.join(config.dirs.config, 'settings.json');
  if (await exists(file)) {
    const s = await readJson<{ immichUrl?: string; immichApiKey?: string; defaultVendorId?: string }>(file, {});
    if (s.immichUrl && !config.immich.url && !getSetting('immich_url')) {
      let url = '';
      try {
        url = normalizeImmichUrl(s.immichUrl);
      } catch {
        log(`Ignored the 1.0 Immich URL "${String(s.immichUrl).slice(0, 80)}" (not a valid http(s) URL). Set it in Settings → Server.`);
      }
      if (url) {
        setSetting('immich_url', url);
        log(`Kept the Immich server URL from the old settings: ${url}`);
      }
    }
    if (s.defaultVendorId && !getSetting('legacy_default_vendor')) setSetting('legacy_default_vendor', String(s.defaultVendorId).slice(0, 40));
    await secureUnlink(file);
    if (s.immichApiKey) log('Removed the old shared Immich API key from settings.json. Each person now links their own read-only key in Profile → Immich connection.');
  }
  if (config.legacy.immichApiKey) log('IMMICH_API_KEY is set but no longer used: each person links their own read-only Immich key. Remove it from your container settings.');
  if (config.legacy.basicAuth) log('AUTH_USERNAME/AUTH_PASSWORD are no longer used: HomeCard now has its own accounts. Remove them from your container settings.');

  if (getSetting('cache_layout') !== CACHE_LAYOUT) {
    let removed = 0;
    for (const e of await fsp.readdir(config.dirs.cache, { withFileTypes: true }).catch(() => [])) {
      if (e.name === 'users') continue;
      await fsp.rm(path.join(config.dirs.cache, e.name), { recursive: true, force: true }).catch(() => {});
      removed++;
    }
    setSetting('cache_layout', CACHE_LAYOUT);
    if (removed) log('Cleared the 1.0 media cache (thumbnails are rebuilt per user on demand).');
  }
}

/** Move a file or folder; across devices (or off a read-only mount) copy and try to remove the source. */
async function moveTree(src: string, dest: string, log: (m: string) => void): Promise<boolean> {
  if (await exists(dest)) {
    log(`Skipped ${src}: ${dest} already exists.`);
    return false;
  }
  await ensureDir(path.dirname(dest));
  try {
    await fsp.rename(src, dest);
    return true;
  } catch (err: any) {
    if (!['EXDEV', 'EROFS', 'EPERM', 'EACCES', 'EBUSY'].includes(err?.code)) throw err;
  }
  await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  await fsp.rm(src, { recursive: true, force: true }).catch(() => log(`Copied ${src} but couldn't remove the original (read-only mount?). It is no longer shown in HomeCard; delete it when convenient.`));
  return true;
}

async function rewriteRefs(file: string, map: (ref: string) => Promise<string>) {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return false;
  }
  if (!raw.includes('library:')) return false;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  let changed = false;
  const walk = async (v: any): Promise<any> => {
    if (typeof v === 'string') {
      if (!v.startsWith('library:')) return v;
      const n = await map(v);
      if (n !== v) changed = true;
      return n;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = await walk(v[i]);
      return v;
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) v[k] = await walk(v[k]);
      return v;
    }
    return v;
  };
  data = await walk(data);
  if (changed) await writeFileAtomic(file, JSON.stringify(data));
  return changed;
}

export async function adoptLegacyData(admin: UserRow, log: (m: string) => void) {
  const result = { projects: 0, exports: 0, uploads: 0, rewritten: 0 };

  // Browser uploads in the single-user builds lived inside the photo library.
  const legacyUploads = path.join(config.dirs.photos, 'uploads');
  const uploadsDest = userUploadsDir(admin.id);
  for (const e of await fsp.readdir(legacyUploads, { withFileTypes: true }).catch(() => [])) {
    if (await moveTree(path.join(legacyUploads, e.name), path.join(uploadsDest, e.name), log).catch((err) => (log(`Couldn't move upload ${e.name}: ${err?.message}`), false))) result.uploads++;
  }

  // Projects.
  for (const e of await fsp.readdir(config.dirs.projects, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.') || USER_ID_RE.test(e.name)) continue;
    const src = path.join(config.dirs.projects, e.name);
    if (!(await exists(path.join(src, 'project.json')))) continue;
    if (await moveTree(src, path.join(userProjectsDir(admin.id), e.name), log).catch((err) => (log(`Couldn't move project ${e.name}: ${err?.message}`), false))) result.projects++;
  }

  // Exports.
  for (const e of await fsp.readdir(config.dirs.exports, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.') || USER_ID_RE.test(e.name)) continue;
    if (await moveTree(path.join(config.dirs.exports, e.name), path.join(userExportsDir(admin.id), e.name), log).catch((err) => (log(`Couldn't move export ${e.name}: ${err?.message}`), false))) result.exports++;
  }

  // Point photo references at the new locations.
  const shared = path.join(config.dirs.photos, 'shared');
  const mine = path.join(config.dirs.photos, 'users', admin.username);
  const mapRef = async (ref: string) => {
    const rel = ref.slice('library:'.length).replace(/\\/g, '/');
    if (rel.startsWith('shared/') || rel.startsWith('users/')) return ref;
    if (rel.startsWith('uploads/')) return `upload:${rel.slice('uploads/'.length)}`;
    if (await exists(path.join(shared, rel))) return `library:shared/${rel}`;
    if (await exists(path.join(mine, rel))) return `library:users/${admin.username}/${rel}`;
    return ref;
  };
  const projectsRoot = userProjectsDir(admin.id);
  for (const e of await fsp.readdir(projectsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(projectsRoot, e.name);
    if (await rewriteRefs(path.join(dir, 'project.json'), mapRef)) result.rewritten++;
    for (const v of await fsp.readdir(path.join(dir, 'versions')).catch(() => [] as string[])) {
      if (v.endsWith('.json')) await rewriteRefs(path.join(dir, 'versions', v), mapRef);
    }
  }

  const vendor = getSetting('legacy_default_vendor');
  if (vendor) {
    updateUserFields(admin.id, { prefs: { ...parsePrefs(admin.prefs), defaultVendorId: vendor } });
    setSetting('legacy_default_vendor', null);
  }

  await reconcileProjects(log);
  if (result.exports) await rescanExports();
  if (result.projects || result.exports || result.uploads) {
    log(`Moved ${result.projects} project(s), ${result.exports} export folder(s) and ${result.uploads} upload folder(s) from the single-user install into ${admin.username}'s account.`);
  }
  return result;
}
