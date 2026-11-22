import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import type { Actor } from '../auth/context';
import { assertId } from '../immich/assets';
import { clientForUser } from '../immich/credentials';
import { sharedPhotosDir, userCacheBucket, userPhotosDir, userUploadsDir } from '../storage/paths';
import { cacheGet, cachePut, once } from '../util/cache';
import { EphemeralScope } from '../util/ephemeral';
import { httpError, safeRealPath } from '../util/fsx';

sharp.cache({ memory: 256, files: 20, items: 100 });
sharp.concurrency(Math.max(1, Math.min(4, os.cpus().length)));

export const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|tiff?|avif|gif)$/i;

/**
 * Photo references and who may read them:
 *   immich:<uuid>                 the signed-in user's own Immich library (their own API key)
 *   library:shared/<path>         /data/photos/shared — every signed-in user
 *   library:users/<name>/<path>   /data/photos/users/<name> — only the user with that username
 *   upload:<path>                 /data/uploads/<userId>/<path> — only the uploader
 * Access is decided from the authenticated actor, never from the ref alone.
 */

export interface MediaCtx {
  userId: string;
  username: string;
  /** Private scratch space for Immich originals (render jobs). */
  scope: EphemeralScope | null;
}

export const ctxOf = (a: Actor): MediaCtx => ({ userId: a.userId, username: a.username, scope: a.scope });

export type ParsedRef = { kind: 'immich'; id: string } | { kind: 'library'; rel: string; root: string; sub: string } | { kind: 'upload'; rel: string; root: string };

export function parseRef(ref: string, ctx: MediaCtx): ParsedRef {
  if (typeof ref !== 'string' || !ref) throw httpError(400, 'Missing ref');
  if (ref.startsWith('immich:')) return { kind: 'immich', id: assertId(ref.slice(7)) };
  if (ref.startsWith('library:')) {
    const rel = ref.slice(8).replace(/\\/g, '/');
    if (!IMAGE_EXT.test(rel)) throw httpError(400, 'Unsupported file type');
    if (rel.startsWith('shared/')) return { kind: 'library', rel, root: sharedPhotosDir(), sub: rel.slice('shared/'.length) };
    const own = `users/${ctx.username}/`;
    if (rel.startsWith(own)) return { kind: 'library', rel, root: userPhotosDir(ctx.username), sub: rel.slice(own.length) };
    // Someone else's private folder, or a file outside shared/ and users/: don't reveal it exists.
    throw httpError(404, 'Photo not found');
  }
  if (ref.startsWith('upload:')) {
    const rel = ref.slice(7).replace(/\\/g, '/');
    if (!IMAGE_EXT.test(rel)) throw httpError(400, 'Unsupported file type');
    return { kind: 'upload', rel, root: userUploadsDir(ctx.userId) };
  }
  throw httpError(400, `Unknown photo reference "${ref.slice(0, 40)}"`);
}

/** Canonical on-disk path of a local photo (symlinks resolved, must stay inside its root). */
export async function localFile(p: Exclude<ParsedRef, { kind: 'immich' }>) {
  return safeRealPath(p.root, p.kind === 'library' ? p.sub : p.rel);
}

/** Cache bucket: private refs (Immich, uploads) live under the user's own cache folder. */
function bucketFor(p: ParsedRef, ctx: MediaCtx, name: string) {
  return p.kind === 'library' ? name : userCacheBucket(ctx.userId, name);
}

/** Identity used for cache keys (changes when a local file changes; user-scoped for private refs). */
export async function sourceKey(ref: string, ctx: MediaCtx): Promise<string> {
  const p = parseRef(ref, ctx);
  if (p.kind === 'immich') return `immich:${ctx.userId}:${p.id}`;
  const abs = await localFile(p);
  const st = await fsp.stat(abs);
  return p.kind === 'upload' ? `upload:${ctx.userId}:${p.rel}:${Math.round(st.mtimeMs)}:${st.size}` : `library:${p.rel}:${Math.round(st.mtimeMs)}:${st.size}`;
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
export function heifBrand(buf: Buffer): string | null {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brand = buf.toString('ascii', 8, 12);
  if (brand === 'avif' || brand === 'avis') return null;
  if (HEIF_BRANDS.has(brand)) return brand;
  for (let o = 16; o + 4 <= Math.min(buf.length, 64); o += 4) {
    const b = buf.toString('ascii', o, o + 4);
    if (b === 'avif') return null;
    if (HEIF_BRANDS.has(b)) return b;
  }
  return null;
}

/* ---------------- Immich downloads ---------------- */

/** Thumbnails/previews: small derivatives, cached in the user's private cache folder. */
async function immichDerivative(id: string, kind: 'preview' | 'thumbnail', ctx: MediaCtx): Promise<string> {
  const ext = kind === 'thumbnail' ? 'webp' : 'jpg';
  const bucket = userCacheBucket(ctx.userId, `immich-${kind}`);
  const key = `immich:${id}:${kind}`;
  const hit = await cacheGet(bucket, key, ext);
  if (hit) return hit;
  return once(`${ctx.userId}:${key}`, async () => {
    const res = await clientForUser(ctx.userId).getBinary(`/api/assets/${id}/thumbnail?size=${kind}`);
    if (!res.ok) throw httpError(res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? res.status : 502, `Immich ${kind} unavailable for ${id} (${res.status})`);
    // Re-encode instead of caching Immich's bytes: a derivative can carry EXIF (GPS, camera serial…),
    // and nothing with location data should sit on disk or reach the browser. rotate() bakes in the
    // orientation before the metadata goes.
    const img = sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none', limitInputPixels: 120_000_000 }).rotate();
    const clean = kind === 'thumbnail' ? await img.webp({ quality: 82 }).toBuffer() : await img.jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
    return cachePut(bucket, key, ext, clean);
  });
}

/** Full-resolution files from Immich go ONLY into the ephemeral scope — never into the cache. */
async function immichFull(id: string, kind: 'original' | 'fullsize', ctx: MediaCtx, scope: EphemeralScope): Promise<string> {
  const file = scope.file(`${id}:${kind}`, kind === 'original' ? 'bin' : 'jpg');
  return once(`${scope.id}:${id}:${kind}`, async () => {
    if (await fsp.access(file).then(() => true, () => false)) return file;
    const url = kind === 'original' ? `/api/assets/${id}/original` : `/api/assets/${id}/thumbnail?size=fullsize`;
    const res = await clientForUser(ctx.userId).getBinary(url, kind === 'original' ? 300_000 : 120_000);
    if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, `Immich ${kind} unavailable for ${id} (${res.status})`);
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
    return file;
  });
}

export const immichPreviewPath = (id: string, ctx: MediaCtx) => immichDerivative(id, 'preview', ctx);
export const immichThumbPath = (id: string, ctx: MediaCtx) => immichDerivative(id, 'thumbnail', ctx);

async function canDecode(input: string | Buffer) {
  try {
    await sharp(input, { failOn: 'none', limitInputPixels: false }).resize(8, 8, { fit: 'inside' }).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

export interface DecodableSource {
  /** Path Sharp can decode directly (original, decoded HEIC, or Immich fallback). */
  path: string;
  width: number;
  height: number;
  via: 'original' | 'fullsize' | 'preview';
  name: string;
  mime: string | null;
  /** True when `path` lives in an ephemeral scope (must not be cached by path). */
  ephemeral: boolean;
}

async function orientedSize(p: string) {
  const m = await sharp(p, { failOn: 'none', limitInputPixels: false }).metadata();
  const w = m.width ?? 0, h = m.height ?? 0;
  return (m.orientation ?? 1) >= 5 ? { width: h, height: w } : { width: w, height: h };
}

async function readHead(file: string) {
  const head = Buffer.alloc(64);
  const fh = await fsp.open(file, 'r');
  try {
    await fh.read(head, 0, 64, 0);
  } finally {
    await fh.close();
  }
  return head;
}

async function decodeHeifTo(srcPath: string, out: string) {
  const buf = await fsp.readFile(srcPath);
  const png = await heicConvert({ buffer: buf as any, format: 'PNG' });
  await fsp.writeFile(out, Buffer.from(png as ArrayBuffer), { mode: 0o600 });
  return out;
}

/**
 * Resolve a ref to a full-resolution file Sharp can decode, converting HEIC/RAW transparently.
 * Immich refs REQUIRE an ephemeral scope: their originals are written there and wiped later.
 */
export async function decodableSource(ref: string, ctx: MediaCtx, scope: EphemeralScope | null): Promise<DecodableSource> {
  const p = parseRef(ref, ctx);
  if (p.kind === 'immich') {
    if (!scope) throw new Error('Immich originals need an ephemeral scope');
    return once(`src:${scope.id}:${p.id}`, async () => {
      let src = await immichFull(p.id, 'original', ctx, scope);
      let via: DecodableSource['via'] = 'original';
      let mime: string | null = null;
      if (heifBrand(await readHead(src))) {
        mime = 'image/heic';
        src = await decodeHeifTo(src, scope.file(`${p.id}:heif`, 'png'));
      } else if (!(await canDecode(src))) {
        // RAW or exotic format: use Immich's server-side conversion.
        try {
          src = await immichFull(p.id, 'fullsize', ctx, scope);
          via = 'fullsize';
          if (!(await canDecode(src))) throw new Error('fullsize not decodable');
        } catch {
          src = await immichPreviewPath(p.id, ctx);
          via = 'preview';
        }
      }
      return { path: src, ...(await orientedSize(src)), via, name: p.id, mime, ephemeral: via !== 'preview' };
    });
  }

  const key = await sourceKey(ref, ctx);
  const metaBucket = bucketFor(p, ctx, 'source');
  const meta = await cacheGet(metaBucket, key, 'json');
  if (meta) {
    const s = JSON.parse(await fsp.readFile(meta, 'utf8')) as DecodableSource;
    if (await fsp.access(s.path).then(() => true, () => false)) return s;
  }
  return once(`src:${key}`, async () => {
    let src = await localFile(p);
    const name = path.basename(p.rel);
    let mime: string | null = null;
    if (heifBrand(await readHead(src))) {
      mime = 'image/heic';
      const heifBucket = bucketFor(p, ctx, 'heif');
      src = (await cacheGet(heifBucket, key, 'png')) ?? (await cachePut(heifBucket, key, 'png', Buffer.from((await heicConvert({ buffer: (await fsp.readFile(src)) as any, format: 'PNG' })) as ArrayBuffer)));
    } else if (!(await canDecode(src))) {
      throw httpError(415, `Can't decode ${name}. Supported: JPG, PNG, WebP, HEIC/HEIF, TIFF, AVIF.`);
    }
    const result: DecodableSource = { path: src, ...(await orientedSize(src)), via: 'original', name, mime, ephemeral: false };
    await cachePut(metaBucket, key, 'json', JSON.stringify(result));
    return result;
  });
}

export { bucketFor };
