import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import type { StockItem, StockProviderId, StockSearchQuery, StockSearchResult, StockSelection } from '@homecard/shared';
import { actorOf, clientIp, userOf } from '../auth/context';
import { config } from '../config';
import { one, run } from '../db';
import { audit } from '../security/audit';
import { packAssetFile, saveBackgroundToUploads, STOCK_CACHE_DIR } from '../styles/styles';
import { cacheGet, cachePut, once, purgeCacheBucket } from '../util/cache';
import { ensureDir, exists, HttpError, httpError, safeRealPath, sha1, writeFileAtomic } from '../util/fsx';
import { safeGet } from './net';
import { getProviderItem, providerEnabled, providerInfo, searchProvider, unsplashTrack, type ProviderItem } from './providers';

/**
 * Backgrounds & Textures: stock search (Pixabay, Unsplash, Openverse), server-side download into
 * /data/styles/stock-cache (never hotlinked for printing), "Save to Local Styles", and the
 * "Soften" filter that upsamples a low-resolution background to the print size with a gentle blur.
 */

const DAY = 24 * 3600_000;
const FILE_RE = /^(pixabay|unsplash|openverse)-[\w-]{1,80}\.jpg$/;
const PROVIDERS = new Set<StockProviderId>(['pixabay', 'unsplash', 'openverse']);
const stockDir = () => path.join(config.dirs.styles, STOCK_CACHE_DIR);
const fileNameFor = (provider: StockProviderId, id: string) => `${provider}-${id.replace(/[^\w-]/g, '').slice(0, 80)}.jpg`;
const PROVIDER_NAMES: Record<StockProviderId, string> = { pixabay: 'Pixabay', unsplash: 'Unsplash', openverse: 'Openverse' };

/** Network failures (offline, DNS, timeouts) become a message the user can act on; details go to the log. */
async function viaProvider<T>(req: FastifyRequest, provider: StockProviderId, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    req.log.warn({ err }, `${provider} request failed`);
    throw httpError(502, `${PROVIDER_NAMES[provider] ?? 'The image service'} couldn’t be reached. Check that this server can reach the internet, or try again in a moment.`);
  }
}

/* ---------- per-user rate limits (keeps everyone inside the providers' quotas) ---------- */
const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw httpError(429, 'Too many requests — wait a moment and try again.');
  list.push(now);
  hits.set(key, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
}, 120_000).unref();

/* ---------- 24 h cache in SQLite ---------- */
function rememberItems(items: ProviderItem[]) {
  const now = Date.now();
  for (const it of items) {
    run(
      'INSERT INTO stock_items(key, provider, body, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, created_at = excluded.created_at',
      `${it.item.provider}:${it.item.id}`,
      it.item.provider,
      JSON.stringify(it),
      now,
    );
  }
}

async function lookupItem(provider: StockProviderId, id: string): Promise<ProviderItem> {
  const row = one<{ body: string; created_at: number }>('SELECT body, created_at FROM stock_items WHERE key = ?', `${provider}:${id}`);
  if (row && Date.now() - row.created_at < DAY) return JSON.parse(row.body) as ProviderItem;
  if (!providerEnabled(provider)) throw httpError(409, 'That stock provider isn’t configured on this server.');
  const fresh = await getProviderItem(provider, id);
  if (!fresh) throw httpError(404, 'Image not found at the provider');
  rememberItems([fresh]);
  return fresh;
}

/** Drop search data older than 24 hours: results, item details and proxied thumbnails. */
export function purgeStockCache() {
  const cutoff = Date.now() - DAY;
  run('DELETE FROM stock_items WHERE created_at < ?', cutoff);
  run('DELETE FROM stock_searches WHERE created_at < ?', cutoff);
  void purgeCacheBucket('stock-thumbs', DAY).catch(() => {});
}

function normalizeQuery(raw: Record<string, unknown>): StockSearchQuery {
  const provider = String(raw.provider ?? 'openverse') as StockProviderId;
  if (!PROVIDERS.has(provider)) throw httpError(400, 'Unknown provider');
  const q = String(raw.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) throw httpError(400, 'Type something to search for');
  const imageType = ['all', 'photo', 'illustration', 'vector'].includes(String(raw.imageType)) ? (String(raw.imageType) as StockSearchQuery['imageType']) : 'all';
  const orientation = ['all', 'horizontal', 'vertical', 'squarish'].includes(String(raw.orientation)) ? (String(raw.orientation) as StockSearchQuery['orientation']) : 'all';
  const color = /^[a-z_]{3,20}$/.test(String(raw.color ?? '')) ? String(raw.color) : undefined;
  const page = Math.min(20, Math.max(1, Math.floor(Number(raw.page ?? 1)) || 1));
  return { provider, q, imageType, orientation, color, page };
}

/** Decode, normalise to an sRGB JPEG without metadata, cap the size. */
async function normalizeDownload(body: Buffer) {
  const img = sharp(body, { failOn: 'error', limitInputPixels: 120_000_000 }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw httpError(502, 'The provider sent something that isn’t an image');
  const { data, info } = await img
    .resize({ width: 7000, height: 7000, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .withIccProfile('srgb')
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

interface Sidecar {
  provider: StockProviderId;
  id: string;
  width: number;
  height: number;
  title: string;
  attribution: StockItem['attribution'];
  downloadedAt: string;
}

async function readSidecar(file: string): Promise<Sidecar | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(stockDir(), `${file}.json`), 'utf8')) as Sidecar;
  } catch {
    return null;
  }
}

export function registerStockRoutes(app: FastifyInstance) {
  app.get('/api/stock/providers', async (req) => {
    userOf(req);
    return providerInfo();
  });

  app.get<{ Querystring: Record<string, string> }>('/api/stock/search', async (req, reply): Promise<StockSearchResult> => {
    const me = userOf(req);
    const q = normalizeQuery(req.query);
    if (!providerEnabled(q.provider)) throw httpError(409, `${q.provider} isn’t configured on this server.`);
    reply.header('Cache-Control', 'private, max-age=300');
    const key = sha1(JSON.stringify(q));
    const cached = one<{ body: string; created_at: number }>('SELECT body, created_at FROM stock_searches WHERE key = ?', key);
    if (cached && Date.now() - cached.created_at < DAY) return { ...(JSON.parse(cached.body) as StockSearchResult), cached: true };
    limit(`search:${me.userId}`, 40);
    const page = await viaProvider(req, q.provider, () => once(`stock-search:${key}`, () => searchProvider(q)));
    rememberItems(page.items);
    const result: StockSearchResult = { items: page.items.map((i) => i.item), page: q.page ?? 1, hasMore: page.hasMore, total: page.total, cached: false };
    // Empty pages aren't kept: a provider hiccup shouldn't pin "no results" for a day.
    if (result.items.length) run('INSERT INTO stock_searches(key, body, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, created_at = excluded.created_at', key, JSON.stringify(result), Date.now());
    return result;
  });

  /** Thumbnails for Pixabay/Openverse are fetched by the server: no third-party requests from browsers. */
  app.get<{ Params: { provider: string; id: string } }>('/api/stock/thumb/:provider/:id', async (req, reply) => {
    userOf(req);
    const provider = req.params.provider as StockProviderId;
    if (provider !== 'pixabay' && provider !== 'openverse') throw httpError(404, 'No proxied thumbnails for this provider');
    const id = String(req.params.id).slice(0, 80);
    const key = sha1(`${provider}:${id}`);
    // Search data may only be kept for 24 hours (Pixabay's API terms), thumbnails included.
    let file = await cacheGet('stock-thumbs', key, 'jpg', { maxAgeMs: DAY });
    if (!file) {
      file = await once(`stock-thumb:${key}`, async () => {
        const it = await lookupItem(provider, id);
        if (!it.thumbSource) throw httpError(404, 'No thumbnail');
        const r = await safeGet(it.thumbSource, { hosts: it.thumbHosts ?? [], maxBytes: 8 * 1024 * 1024, timeoutMs: 15_000 });
        if (r.status >= 400) throw httpError(502, `Thumbnail unavailable (HTTP ${r.status})`);
        const buf = await sharp(r.body, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        return cachePut('stock-thumbs', key, 'jpg', buf);
      });
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(createReadStream(file));
  });

  /** Use a stock image as a background: download the print-size file once, return a "stock:" ref. */
  app.post<{ Body: { provider?: string; id?: string } }>('/api/stock/select', async (req): Promise<StockSelection> => {
    const me = userOf(req);
    const provider = String(req.body?.provider ?? '') as StockProviderId;
    const id = String(req.body?.id ?? '').slice(0, 80);
    if (!PROVIDERS.has(provider) || !id) throw httpError(400, 'provider and id required');
    limit(`select:${me.userId}`, 20);
    const file = fileNameFor(provider, id);
    const abs = path.join(stockDir(), file);
    const it = await viaProvider(req, provider, () => lookupItem(provider, id));
    if (provider === 'unsplash' && it.trackUrl) void unsplashTrack(it.trackUrl);
    const existing = await readSidecar(file);
    if (existing && (await exists(abs))) return { ref: `stock:${file}`, width: existing.width, height: existing.height, attribution: existing.attribution };

    return viaProvider(req, provider, () => once(`stock-dl:${file}`, async () => {
      if (!it.downloadUrl) throw httpError(404, 'This image can’t be downloaded');
      const r = await safeGet(it.downloadUrl, { hosts: it.downloadHosts, allowHttp: it.allowHttp, maxBytes: 60 * 1024 * 1024, timeoutMs: 60_000 });
      if (r.status >= 400) throw httpError(502, `Download failed (HTTP ${r.status})`);
      const n = await normalizeDownload(r.body);
      await ensureDir(stockDir());
      await writeFileAtomic(abs, n.data);
      const side: Sidecar = { provider, id, width: n.width, height: n.height, title: it.item.title, attribution: it.item.attribution, downloadedAt: new Date().toISOString() };
      await writeFileAtomic(path.join(stockDir(), `${file}.json`), JSON.stringify(side, null, 1));
      return { ref: `stock:${file}`, width: n.width, height: n.height, attribution: it.item.attribution };
    }));
  });

  /** Downloaded stock backgrounds (shared by everyone: they're public stock images). */
  app.get<{ Params: { name: string } }>('/api/stock/file/:name', async (req, reply) => {
    actorOf(req); // signed-in users and the print renderer
    if (!FILE_RE.test(req.params.name)) throw httpError(400, 'Bad file name');
    const abs = await safeRealPath(stockDir(), req.params.name);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(createReadStream(abs));
  });

  /** Recently used stock backgrounds (newest first). */
  app.get('/api/stock/recent', async (req) => {
    userOf(req);
    const out: StockSelection[] = [];
    for (const f of await fsp.readdir(stockDir()).catch(() => [] as string[])) {
      if (!FILE_RE.test(f)) continue;
      const side = await readSidecar(f);
      if (side) out.push({ ref: `stock:${f}`, width: side.width, height: side.height, attribution: side.attribution, at: side.downloadedAt } as StockSelection & { at: string });
    }
    return out.sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
  });

  /** "Save to Local Styles": keep a stock background permanently in My Uploads. */
  app.post<{ Body: { ref?: string; name?: string } }>('/api/stock/save', async (req) => {
    const me = userOf(req);
    const ref = String(req.body?.ref ?? '');
    const m = /^stock:(.+)$/.exec(ref);
    if (!m || !FILE_RE.test(m[1])) throw httpError(400, 'Not a stock background');
    const abs = await safeRealPath(stockDir(), m[1]);
    const side = await readSidecar(m[1]);
    const name = String(req.body?.name ?? side?.title ?? m[1]).slice(0, 60);
    const packRef = await saveBackgroundToUploads(abs, name, side?.attribution.text);
    audit({ event: 'stock.saved', userId: me.userId, username: me.username, ip: clientIp(req), detail: { ref, saved: packRef } });
    return { ref: packRef };
  });

  /**
   * "Soften": upsample a background to the exact pixel width it prints at (Lanczos) and add a
   * blur proportional to the enlargement, so a 1280 px scenic or bokeh photo prints smooth
   * instead of blocky. Cached per source + width.
   */
  app.get<{ Querystring: { ref?: string; w?: string } }>('/api/backgrounds/soft', async (req, reply) => {
    actorOf(req);
    const ref = String(req.query.ref ?? '');
    const w = Math.min(8000, Math.max(200, Math.round(Number(req.query.w) || 0)));
    let src: string;
    if (ref.startsWith('stock:') && FILE_RE.test(ref.slice(6))) src = await safeRealPath(stockDir(), ref.slice(6));
    else if (ref.startsWith('pack:') && /\.(png|jpe?g|webp)$/i.test(ref)) src = await packAssetFile(ref);
    else throw httpError(400, 'Soften works on stock and style-pack images');
    const st = await fsp.stat(src);
    const key = sha1(`${ref}|${w}|${st.mtimeMs}|${st.size}`);
    let out = await cacheGet('soft', key, 'jpg');
    if (!out) {
      out = await once(`soft:${key}`, async () => {
        const meta = await sharp(src).metadata();
        const srcW = ((meta.orientation ?? 1) >= 5 ? meta.height : meta.width) ?? w;
        const k = w / Math.max(1, srcW);
        const sigma = Math.min(14, Math.max(0.4, 0.45 * k + (k > 1 ? 0.35 : 0)));
        const buf = await sharp(src, { limitInputPixels: 120_000_000 })
          .rotate()
          .resize({ width: w, kernel: 'lanczos3' })
          .blur(sigma)
          .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
          .withIccProfile('srgb')
          .toBuffer();
        return cachePut('soft', key, 'jpg', buf);
      });
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(createReadStream(out));
  });
}
