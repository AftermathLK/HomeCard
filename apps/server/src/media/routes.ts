import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import sharp from 'sharp';
import {
  applyPipeline,
  buildPipeline,
  fromBase64Url,
  hashString,
  saliencyFocus,
  type Adjustments,
  type FaceBox,
  type MediaInfo,
} from '@homecard/shared';
import { actorOf } from '../auth/context';
import { orientedDims, immichFaces, type ImmichAsset } from '../immich/assets';
import { clientForUser } from '../immich/credentials';
import { userCacheBucket } from '../storage/paths';
import { cacheGet, cachePut, once } from '../util/cache';
import { EphemeralScope, withEphemeral } from '../util/ephemeral';
import { httpError } from '../util/fsx';
import { bucketFor, ctxOf, decodableSource, immichPreviewPath, immichThumbPath, localFile, parseRef, sourceKey, type DecodableSource, type MediaCtx } from './sources';

const THUMB = 420;
const PREVIEW = 1600;

function sendFile(reply: FastifyReply, file: string, type: string, maxAge = 86400) {
  reply.header('Cache-Control', `private, max-age=${maxAge}`);
  return reply.type(type).send(createReadStream(file));
}

async function localDerivative(ref: string, ctx: MediaCtx, size: number, bucket: string, quality: number) {
  const p = parseRef(ref, ctx);
  const key = `${await sourceKey(ref, ctx)}:${size}`;
  const b = bucketFor(p, ctx, bucket);
  const hit = await cacheGet(b, key, 'jpg');
  if (hit) return hit;
  return once(`${b}:${key}`, async () => {
    const src = await decodableSource(ref, ctx, null);
    const buf = await sharp(src.path, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .withIccProfile('srgb')
      .toBuffer();
    return cachePut(b, key, 'jpg', buf);
  });
}

export async function previewPath(ref: string, ctx: MediaCtx): Promise<string> {
  const p = parseRef(ref, ctx);
  if (p.kind === 'immich') return immichPreviewPath(p.id, ctx);
  return localDerivative(ref, ctx, PREVIEW, 'preview', 86);
}

/** Exact-width print JPEG with Photo Polish baked in. Sharp writes no EXIF/GPS/XMP — only sRGB ICC. */
async function renderPrintJpeg(src: DecodableSource, w: number, adj: Partial<Adjustments> | null): Promise<Buffer> {
  let img = sharp(src.path, { failOn: 'none', limitInputPixels: false })
    .rotate()
    .resize({ width: w, kernel: 'lanczos3', withoutEnlargement: true, fastShrinkOnLoad: false })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb');
  if (adj && Object.keys(adj).length) {
    const pipe = buildPipeline(adj);
    if (!pipe.identity) {
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      applyPipeline(data, info.channels as 3 | 4, pipe);
      img = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    }
  }
  return img.jpeg({ quality: 97, chromaSubsampling: '4:4:4', mozjpeg: false }).withIccProfile('srgb').toBuffer();
}

/**
 * Full-resolution print source resized (Lanczos3) to exactly the pixel width the frame needs.
 * Immich photos: original AND result live only in the ephemeral scope (wiped after the render).
 */
export async function printSource(ref: string, width: number, adj: Partial<Adjustments> | null, ctx: MediaCtx, scope: EphemeralScope) {
  const p = parseRef(ref, ctx);
  const src = await decodableSource(ref, ctx, scope);
  const w = Math.max(16, Math.min(Math.round(width), src.width));
  const adjKey = adj && Object.keys(adj).length ? hashString(JSON.stringify(adj)) : 'none';
  if (p.kind === 'immich') {
    const out = scope.file(`print:${p.id}:${w}:${adjKey}`, 'jpg');
    await once(`print:${scope.id}:${p.id}:${w}:${adjKey}`, async () => {
      if (await fsp.access(out).then(() => true, () => false)) return;
      await fsp.writeFile(out, await renderPrintJpeg(src, w, adj), { mode: 0o600 });
    });
    return { path: out, width: w, source: src };
  }
  const key = `${await sourceKey(ref, ctx)}:${w}:${adjKey}:v2`;
  const b = bucketFor(p, ctx, 'print');
  const hit = await cacheGet(b, key, 'jpg');
  if (hit) return { path: hit, width: w, source: src };
  const file = await once(`print:${b}:${key}`, async () => cachePut(b, key, 'jpg', await renderPrintJpeg(src, w, adj)));
  return { path: file, width: w, source: src };
}

/** Faces detected in the browser for local photos, stored per user. */
async function readFaces(ref: string, ctx: MediaCtx): Promise<FaceBox[] | null> {
  const p = await cacheGet(userCacheBucket(ctx.userId, 'faces'), await sourceKey(ref, ctx), 'json');
  return p ? (JSON.parse(await fsp.readFile(p, 'utf8')) as FaceBox[]) : null;
}

async function focusFor(file: string) {
  const { data, info } = await sharp(file, { failOn: 'none' }).rotate().resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return saliencyFocus(data, info.width, info.height, 3);
}

export async function mediaInfo(ref: string, ctx: MediaCtx): Promise<MediaInfo> {
  const p = parseRef(ref, ctx);
  const key = await sourceKey(ref, ctx);
  const infoBucket = bucketFor(p, ctx, 'info');
  const cached = await cacheGet(infoBucket, key, 'json');
  const storedFaces = await readFaces(ref, ctx);
  if (cached) {
    const info = JSON.parse(await fsp.readFile(cached, 'utf8')) as MediaInfo;
    if (storedFaces) return { ...info, faces: storedFaces, facesSource: 'local', facesKnown: true };
    return info;
  }
  return once(`info:${infoBucket}:${key}`, async () => {
    let info: MediaInfo;
    if (p.kind === 'immich') {
      const c = clientForUser(ctx.userId);
      const [asset, faces, preview] = await Promise.all([
        c.get<ImmichAsset>(`/api/assets/${p.id}`),
        immichFaces(c, p.id).catch(() => [] as FaceBox[]),
        immichPreviewPath(p.id, ctx),
      ]);
      const pm = await sharp(preview).metadata();
      let { width, height } = orientedDims(asset);
      const previewLandscape = (pm.width ?? 1) >= (pm.height ?? 1);
      if (!width || !height) {
        // Size unknown: read it from the original inside a throwaway scope.
        const src = await (ctx.scope ? decodableSource(ref, ctx, ctx.scope) : withEphemeral('info', (s) => decodableSource(ref, ctx, s)));
        width = src.width;
        height = src.height;
      } else if ((width >= height) !== previewLandscape && Math.abs(width - height) > 2) {
        [width, height] = [height, width];
      }
      const lower = (asset.originalFileName ?? '').toLowerCase();
      const isRaw = /\.(dng|cr2|cr3|nef|arw|raf|orf|rw2|pef|srw)$/.test(lower);
      info = {
        ref,
        name: asset.originalFileName ?? p.id,
        width,
        height,
        faces: faces.length ? faces : undefined,
        facesSource: faces.length ? 'immich' : 'none',
        facesKnown: faces.length > 0,
        focus: await focusFor(preview),
        takenAt: asset.localDateTime ?? asset.fileCreatedAt ?? null,
        mime: asset.originalMimeType ?? null,
        printSource: isRaw ? 'fullsize' : 'original',
      };
    } else {
      const src = await decodableSource(ref, ctx, null);
      info = {
        ref,
        name: path.basename(p.rel),
        width: src.width,
        height: src.height,
        faces: storedFaces ?? undefined,
        facesSource: storedFaces ? 'local' : undefined,
        facesKnown: !!storedFaces,
        focus: await focusFor(await previewPath(ref, ctx)),
        takenAt: (await fsp.stat(await localFile(p))).mtime.toISOString(),
        mime: src.mime,
        printSource: 'original',
      };
    }
    await cachePut(infoBucket, key, 'json', JSON.stringify({ ...info, faces: info.facesSource === 'local' ? undefined : info.faces }));
    return info;
  });
}

export function registerMediaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { ref: string } }>('/api/media/thumb', async (req, reply) => {
    const ctx = ctxOf(actorOf(req));
    const p = parseRef(req.query.ref, ctx);
    if (p.kind === 'immich') return sendFile(reply, await immichThumbPath(p.id, ctx), 'image/webp');
    return sendFile(reply, await localDerivative(req.query.ref, ctx, THUMB, 'thumb', 80), 'image/jpeg');
  });

  app.get<{ Querystring: { ref: string } }>('/api/media/preview', async (req, reply) => {
    const ctx = ctxOf(actorOf(req));
    return sendFile(reply, await previewPath(req.query.ref, ctx), 'image/jpeg');
  });

  app.get<{ Querystring: { ref: string; w?: string; adj?: string } }>('/api/media/print', async (req, reply) => {
    const actor = actorOf(req);
    const ctx = ctxOf(actor);
    const w = Number(req.query.w ?? 0);
    if (!Number.isFinite(w) || w < 1 || w > 30000) throw httpError(400, 'w must be a positive pixel width');
    let adj: Partial<Adjustments> | null = null;
    if (req.query.adj) {
      try {
        adj = fromBase64Url<Partial<Adjustments>>(req.query.adj);
      } catch {
        throw httpError(400, 'Invalid adj');
      }
    }
    const headers = (out: Awaited<ReturnType<typeof printSource>>) => {
      reply.header('X-Source-Width', String(out.source.width));
      reply.header('X-Source-Via', out.source.via);
      reply.header('Cache-Control', 'private, no-store');
    };
    if (actor.scope) {
      // Render job: its scope is wiped when the export finishes.
      const out = await printSource(req.query.ref, w, adj, ctx, actor.scope);
      headers(out);
      return reply.type('image/jpeg').send(createReadStream(out.path));
    }
    // Direct request by a signed-in user: build in a one-off scope, send from memory, wipe.
    const { buf, out } = await withEphemeral('print', async (scope) => {
      const out = await printSource(req.query.ref, w, adj, ctx, scope);
      return { buf: await fsp.readFile(out.path), out };
    });
    headers(out);
    return reply.type('image/jpeg').send(buf);
  });

  app.get<{ Querystring: { ref: string } }>('/api/media/info', async (req) => mediaInfo(req.query.ref, ctxOf(actorOf(req))));

  app.post<{ Body: { refs: string[] } }>('/api/media/info', async (req) => {
    const ctx = ctxOf(actorOf(req));
    const refs = Array.isArray(req.body?.refs) ? req.body.refs.slice(0, 200).map(String) : [];
    const results = await Promise.allSettled(refs.map((r) => mediaInfo(r, ctx)));
    return results.map((r, i) => (r.status === 'fulfilled' ? r.value : { ref: refs[i], error: String((r.reason as Error)?.message ?? r.reason) }));
  });

  /** Store faces detected in the browser for local photos (computed once, reused; per user). */
  app.put<{ Body: { ref: string; faces: FaceBox[] } }>('/api/media/faces', async (req) => {
    const ctx = ctxOf(actorOf(req));
    const { ref, faces } = req.body ?? ({} as any);
    parseRef(ref, ctx);
    if (!Array.isArray(faces)) throw httpError(400, 'faces must be an array');
    const clean = faces
      .filter((f) => [f.x, f.y, f.w, f.h].every((v) => typeof v === 'number' && isFinite(v)))
      .slice(0, 50)
      .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, score: typeof f.score === 'number' ? f.score : undefined }));
    await cachePut(userCacheBucket(ctx.userId, 'faces'), await sourceKey(ref, ctx), 'json', JSON.stringify(clean));
    return { ok: true, count: clean.length };
  });
}
