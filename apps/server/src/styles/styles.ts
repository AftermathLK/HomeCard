import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import type { FastifyInstance } from 'fastify';
import { parsePackAssetRef, resolveStylePack, type ResolvedStylePack, type StylePackManifest } from '@homecard/shared';
import { clientIp, userOf } from '../auth/context';
import { config } from '../config';
import { emit } from '../events';
import { audit } from '../security/audit';
import { ensureDir, exists, httpError, safeJoin, safeRealPath, sanitizeFileName, slugify, toPosix, uniquePath, writeFileAtomic } from '../util/fsx';
import { sanitizeSvg } from './sanitize';

const UPLOADS_DIR = '_uploads';
/** Downloaded stock backgrounds (not a pack; served by /api/stock/file). */
export const STOCK_CACHE_DIR = 'stock-cache';
const RESERVED_IDS = new Set([STOCK_CACHE_DIR, 'my-uploads']);
const MAX_UNZIPPED = 300 * 1024 * 1024;
const ASSET_EXT = /\.(svg|png|jpe?g|webp)$/i;

let packs: ResolvedStylePack[] = [];
const packDirs = new Map<string, string>();
const svgCache = new Map<string, string>();
let version = Date.now();

async function listFiles(dir: string, re: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isFile() && re.test(e.name)) out.push(e.name);
  }
  return out.sort();
}

/** "My Uploads" pack synthesised from files dropped into /data/styles/_uploads/{backgrounds,ornaments,stickers}. */
async function uploadsPack(): Promise<ResolvedStylePack | null> {
  const root = path.join(config.dirs.styles, UPLOADS_DIR);
  if (!(await exists(root))) return null;
  const nice = (f: string) => f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const bgs = await listFiles(path.join(root, 'backgrounds'), ASSET_EXT);
  const orns = await listFiles(path.join(root, 'ornaments'), /\.svg$/i);
  const stks = await listFiles(path.join(root, 'stickers'), ASSET_EXT);
  if (!bgs.length && !orns.length && !stks.length) return null;
  const manifest: StylePackManifest = {
    id: 'my-uploads',
    name: 'My Uploads',
    description: 'Files you uploaded in HomeCard (stored in /data/styles/_uploads).',
    backgrounds: bgs.map((f) => ({ id: slugify(f), name: nice(f), file: `backgrounds/${f}`, mode: /\.jpe?g$/i.test(f) ? 'cover' : 'tile', kind: /\.jpe?g$/i.test(f) ? 'image' : 'overlay', tileSizeIn: 2 })),
    ornaments: orns.map((f) => ({ id: slugify(f), name: nice(f), file: `ornaments/${f}` })),
    stickers: stks.map((f) => ({ id: slugify(f), name: nice(f), file: `stickers/${f}` })),
  };
  const r = resolveStylePack(manifest, 'uploads');
  packDirs.set(r.id, root);
  return r;
}

export async function rescanStyles() {
  await ensureDir(config.dirs.styles);
  packDirs.clear();
  svgCache.clear();
  const found: ResolvedStylePack[] = [];
  const entries = await fsp.readdir(config.dirs.styles, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === UPLOADS_DIR || e.name === STOCK_CACHE_DIR) continue;
    const abs = path.join(config.dirs.styles, e.name);
    let manifestFile: string | null = null;
    let base = config.dirs.styles;
    if (e.isDirectory()) {
      for (const n of ['pack.json', 'style-pack.json', 'stylepack.json']) {
        if (await exists(path.join(abs, n))) {
          manifestFile = path.join(abs, n);
          base = abs;
          break;
        }
      }
    } else if (e.isFile() && /\.json$/i.test(e.name) && !/\.schema\.json$/i.test(e.name)) {
      manifestFile = abs;
    }
    if (!manifestFile) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
      // Templates may be referenced as separate JSON files.
      if (Array.isArray(raw.templates)) {
        raw.templates = await Promise.all(
          raw.templates.map(async (t: unknown) => {
            if (typeof t !== 'string') return t;
            try {
              return JSON.parse(await fsp.readFile(safeJoin(base, t), 'utf8'));
            } catch {
              return t; // keeps the file name so the pack's error list says which template failed
            }
          }),
        );
      }
      const r = resolveStylePack(raw, base === config.dirs.styles ? 'pack' : 'pack');
      if (!r.id) {
        found.push({ ...r, id: `invalid-${slugify(e.name)}`, name: `${e.name} (invalid)` });
        continue;
      }
      if (packDirs.has(r.id)) {
        r.errors.push(`Duplicate pack id "${r.id}" — ignored ${e.name}.`);
        continue;
      }
      packDirs.set(r.id, base);
      // Verify referenced files exist.
      for (const a of [...r.backgrounds, ...r.ornaments, ...r.stickers]) {
        if (!(await exists(safeJoin(base, a.file)))) r.errors.push(`Missing file: ${a.file}`);
      }
      found.push(r);
    } catch (err: any) {
      found.push({ ...resolveStylePack({ id: slugify(e.name), name: `${e.name} (unreadable)` }), errors: [`Could not parse ${path.basename(manifestFile)}: ${err.message}`] });
    }
  }
  const up = await uploadsPack();
  if (up) found.push(up);
  packs = found.sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'uploads' ? 1 : -1));
  version = Date.now();
  return packs;
}

export function stylePacks() {
  return packs;
}

/** Canonical path of a pack file: must resolve (symlinks included) inside the pack folder. */
async function packFile(packId: string, rel: string) {
  const dir = packDirs.get(packId);
  if (!dir) throw httpError(404, `Unknown style pack "${packId}"`);
  if (!ASSET_EXT.test(rel)) throw httpError(400, 'Unsupported asset type');
  return safeRealPath(dir, rel);
}

/** Absolute path of a raster pack asset from its "pack:<id>/<file>" reference. */
export async function packAssetFile(ref: string) {
  const p = parsePackAssetRef(String(ref));
  if (!p) throw httpError(400, 'Not a style-pack asset');
  return packFile(p.packId, p.file);
}

export async function sanitizedSvg(packId: string, rel: string) {
  const key = `${packId}/${rel}`;
  const hit = svgCache.get(key);
  if (hit) return hit;
  const abs = await packFile(packId, rel);
  const clean = sanitizeSvg(await fsp.readFile(abs, 'utf8'), key);
  svgCache.set(key, clean);
  return clean;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

export function registerStyleRoutes(app: FastifyInstance) {
  app.get('/api/styles', async () => ({ version, packs }));

  app.post('/api/styles/rescan', async (req) => {
    userOf(req);
    await rescanStyles();
    emit('styles', { version });
    return { version, packs };
  });

  app.get<{ Params: { pack: string; '*': string } }>('/api/styles/file/:pack/*', async (req, reply) => {
    const rel = decodeURIComponent(req.params['*']);
    const ext = path.extname(rel).toLowerCase();
    reply.header('Cache-Control', 'private, max-age=300');
    if (ext === '.svg') {
      reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      return reply.type('image/svg+xml').send(await sanitizedSvg(req.params.pack, rel));
    }
    return reply.type(MIME[ext] ?? 'application/octet-stream').send(createReadStream(await packFile(req.params.pack, rel)));
  });

  /** Upload individual assets into the "My Uploads" pack. */
  app.post<{ Querystring: { kind?: string } }>('/api/styles/upload', async (req) => {
    const me = userOf(req);
    const kind = String(req.query.kind ?? 'stickers');
    const folder = kind === 'backgrounds' || kind === 'ornaments' || kind === 'stickers' ? kind : null;
    if (!folder) throw httpError(400, 'kind must be backgrounds, ornaments or stickers');
    const dir = path.join(config.dirs.styles, UPLOADS_DIR, folder);
    await ensureDir(dir);
    const saved: string[] = [];
    const rejected: string[] = [];
    for await (const part of req.files({ limits: { fileSize: 40 * 1024 * 1024 } })) {
      const name = sanitizeFileName(part.filename);
      const okExt = folder === 'ornaments' ? /\.svg$/i : ASSET_EXT;
      if (!okExt.test(name)) {
        rejected.push(part.filename);
        part.file.resume();
        continue;
      }
      const dest = await uniquePath(dir, name);
      await pipeline(part.file, createWriteStream(dest));
      if (/\.svg$/i.test(dest)) {
        try {
          sanitizeSvg(await fsp.readFile(dest, 'utf8'), dest);
        } catch {
          await fsp.unlink(dest).catch(() => {});
          rejected.push(`${part.filename} (not a valid SVG)`);
          continue;
        }
      }
      saved.push(path.basename(dest));
    }
    await rescanStyles();
    emit('styles', { version });
    if (saved.length) audit({ event: 'styles.uploaded', userId: me.userId, username: me.username, ip: clientIp(req), detail: { kind: folder, files: saved.slice(0, 20) } });
    return { saved, rejected, packs };
  });

  /** Import a Style Pack (.zip containing pack.json, or a standalone .json manifest). */
  app.post('/api/styles/import', async (req) => {
    const me = userOf(req);
    const results: Array<{ file: string; packId?: string; error?: string }> = [];
    for await (const part of req.files({ limits: { fileSize: 150 * 1024 * 1024 } })) {
      const buf = await part.toBuffer();
      const name = part.filename;
      try {
        if (/\.json$/i.test(name)) {
          const json = JSON.parse(buf.toString('utf8'));
          const r = resolveStylePack(json);
          if (!r.id) throw new Error(r.errors.join(' '));
          if (RESERVED_IDS.has(r.id)) throw new Error(`"${r.id}" is reserved — rename the pack id.`);
          await writeFileAtomic(path.join(config.dirs.styles, `${r.id}.json`), JSON.stringify(json, null, 2));
          results.push({ file: name, packId: r.id });
        } else if (/\.zip$/i.test(name)) {
          const zip = new AdmZip(buf);
          const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.startsWith('__MACOSX'));
          const manifestEntry = entries
            .filter((e) => /(^|\/)(pack|style-pack|stylepack)\.json$/i.test(e.entryName))
            .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)[0];
          if (!manifestEntry) throw new Error('Zip has no pack.json');
          const prefix = manifestEntry.entryName.slice(0, manifestEntry.entryName.lastIndexOf('/') + 1);
          const json = JSON.parse(manifestEntry.getData().toString('utf8'));
          const r = resolveStylePack(json);
          if (!r.id) throw new Error(r.errors.join(' '));
          if (RESERVED_IDS.has(r.id)) throw new Error(`"${r.id}" is reserved — rename the pack id.`);
          const dest = path.join(config.dirs.styles, r.id);
          // Pass 1: validate every path and the unpacked size before writing anything, so a bad
          // archive (zip-slip entry, zip bomb) never leaves a half-imported pack behind.
          let total = 0;
          const files: Array<{ out: string; data: Buffer }> = [];
          for (const e of entries) {
            if (!e.entryName.startsWith(prefix)) continue;
            const rel = e.entryName.slice(prefix.length);
            if (!rel || !/\.(json|svg|png|jpe?g|webp|md|txt)$/i.test(rel)) continue;
            let out: string;
            try {
              out = safeJoin(dest, rel); // zip-slip protection
            } catch {
              throw new Error(`Unsafe path in zip: ${e.entryName}`);
            }
            // The declared size is checked before inflating; the real size is what counts.
            if (total + e.header.size > MAX_UNZIPPED) throw new Error('Zip expands to more than 300 MB');
            const data = e.getData();
            total += data.length;
            if (total > MAX_UNZIPPED) throw new Error('Zip expands to more than 300 MB');
            files.push({ out, data });
          }
          // Pass 2: write.
          await ensureDir(dest);
          for (const f of files) {
            await ensureDir(path.dirname(f.out));
            await fsp.writeFile(f.out, f.data);
          }
          results.push({ file: name, packId: r.id });
        } else {
          throw new Error('Upload a .zip or .json style pack');
        }
      } catch (err: any) {
        results.push({ file: name, error: err.message });
      }
    }
    await rescanStyles();
    emit('styles', { version });
    const imported = results.filter((r) => r.packId).map((r) => r.packId);
    if (imported.length) audit({ event: 'styles.imported', userId: me.userId, username: me.username, ip: clientIp(req), detail: { packs: imported } });
    return { results, packs };
  });
}

/**
 * "Save to Local Styles": copy a downloaded stock background into My Uploads → Backgrounds so it
 * stays available offline (and survives stock-cache cleanup). Returns the new pack asset ref.
 */
export async function saveBackgroundToUploads(srcAbs: string, niceName: string, credit?: string) {
  const dir = path.join(config.dirs.styles, UPLOADS_DIR, 'backgrounds');
  await ensureDir(dir);
  const base = `${slugify(niceName, 50) || 'background'}${path.extname(srcAbs).toLowerCase() || '.jpg'}`;
  const dest = await uniquePath(dir, base);
  await fsp.copyFile(srcAbs, dest);
  if (credit) await writeFileAtomic(`${dest}.credit.txt`, credit.slice(0, 500));
  await rescanStyles();
  emit('styles', { version });
  return `pack:my-uploads/backgrounds/${path.basename(dest)}`;
}

/**
 * Starter-kit seeding. Each top-level entry of the bundled starter kit (a pack folder, a pack
 * JSON or a font README) is copied into /data once. The names already seeded are remembered in
 * .homecard-seeded.json, so packs you delete stay deleted and packs added in a newer HomeCard
 * version appear automatically.
 */
export async function seedStarterKit(log: (m: string) => void) {
  const copyTree = async (src: string, dst: string) => {
    const st = await fsp.stat(src);
    if (st.isFile()) {
      if (!(await exists(dst))) await fsp.copyFile(src, dst);
      return;
    }
    await ensureDir(dst);
    for (const e of await fsp.readdir(src, { withFileTypes: true })) await copyTree(path.join(src, e.name), path.join(dst, e.name));
  };
  for (const name of ['styles', 'fonts'] as const) {
    const src = path.join(config.starterDir, name);
    const dst = config.dirs[name];
    if (!(await exists(src))) continue;
    await ensureDir(dst);
    const markerFile = path.join(dst, '.homecard-seeded.json');
    const seeded = new Set<string>(await readJsonSafe(markerFile));
    const added: string[] = [];
    for (const e of await fsp.readdir(src)) {
      if (e.startsWith('.') || seeded.has(e)) continue;
      const target = path.join(dst, e);
      if (!(await exists(target))) {
        await copyTree(path.join(src, e), target);
        added.push(e);
      }
      seeded.add(e);
    }
    await writeFileAtomic(markerFile, JSON.stringify([...seeded].sort(), null, 1));
    if (added.length) log(`Seeded starter ${name}: ${added.join(', ')} -> ${toPosix(dst)}`);
  }
}

async function readJsonSafe(file: string): Promise<string[]> {
  try {
    const v = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
