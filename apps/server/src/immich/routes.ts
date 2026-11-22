import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { ImmichAlbum, ImmichConnectionDto, ImmichKeyCheck, ImmichPerson, ImmichStatus, PhotoPage, TimelineBucket } from '@homecard/shared';
import { actorOf, clientIp, userOf } from '../auth/context';
import { audit } from '../security/audit';
import { userCacheBucket } from '../storage/paths';
import { cacheGet, cachePut, once } from '../util/cache';
import { httpError } from '../util/fsx';
import { assertId, assetToItem, type ImmichAsset, type SearchResponse } from './assets';
import { clientForUser, connectionDto, deleteUserKey, immichServerUrl, saveUserKey, verifyImmichKey, verifyStoredKey } from './credentials';

const PAGE_SIZE = 150;

/**
 * Immich proxy. Every handler builds its client from the AUTHENTICATED user id (session or render
 * grant) — no API key, user id or Immich URL is ever taken from the request.
 */
export function registerImmichRoutes(app: FastifyInstance) {
  /* ---------- Profile → Immich connection ---------- */
  app.get('/api/me/immich', async (req): Promise<ImmichConnectionDto> => connectionDto(userOf(req).userId));

  /** Test a key before saving it (or, without apiKey, re-test the saved key). */
  app.post<{ Body: { apiKey?: string } }>('/api/me/immich/test', async (req): Promise<ImmichKeyCheck> => {
    const me = userOf(req);
    const typed = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const check = typed ? await verifyImmichKey(immichServerUrl().url, typed, me.userId) : await verifyStoredKey(me.userId);
    if (!typed && check.dangerous.length) {
      // The saved key gained write permissions in Immich: stop using it.
      deleteUserKey(me.userId);
      audit({ event: 'immich.key_rejected', outcome: 'denied', userId: me.userId, username: me.username, ip: clientIp(req), detail: { reason: 'stored key now has write scopes', dangerous: check.dangerous } });
    } else {
      audit({ event: 'immich.key_tested', outcome: check.authenticated ? 'ok' : 'error', userId: me.userId, username: me.username, ip: clientIp(req), detail: { stored: !typed, verifiable: check.scopesVerifiable } });
    }
    return check;
  });

  app.put<{ Body: { apiKey?: string; acknowledgeManualScopes?: boolean } }>('/api/me/immich', async (req, reply) => {
    const me = userOf(req);
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!apiKey) throw httpError(400, 'Paste your Immich API key.');
    const { check, saved } = await saveUserKey(me.userId, apiKey, req.body?.acknowledgeManualScopes === true);
    if (!saved) {
      const reason = check.dangerous.length ? 'dangerous scopes' : !check.authenticated ? 'not authenticated' : 'scopes not verifiable';
      audit({ event: 'immich.key_rejected', outcome: 'denied', userId: me.userId, username: me.username, ip: clientIp(req), detail: { reason, dangerous: check.dangerous } });
      const code = check.dangerous.length ? 'dangerous_scopes' : !check.authenticated ? 'not_authenticated' : 'manual_verification_required';
      return reply.code(check.dangerous.length ? 422 : check.authenticated ? 409 : 400).send({ error: check.error ?? check.warning ?? 'The key was not saved.', code, check });
    }
    audit({ event: 'immich.key_saved', userId: me.userId, username: me.username, ip: clientIp(req), detail: { last4: apiKey.slice(-4), scopesVerified: check.scopesVerifiable, manualAck: !check.scopesVerifiable, permissions: check.permissions } });
    return { check, connection: connectionDto(me.userId) };
  });

  app.delete('/api/me/immich', async (req) => {
    const me = userOf(req);
    deleteUserKey(me.userId);
    audit({ event: 'immich.key_removed', userId: me.userId, username: me.username, ip: clientIp(req) });
    return connectionDto(me.userId);
  });

  /* ---------- Picker ---------- */
  app.get('/api/immich/status', async (req): Promise<ImmichStatus> => {
    const me = actorOf(req);
    const conn = connectionDto(me.userId);
    if (!conn.serverConfigured) return { ok: false, configured: false, error: 'Immich isn’t set up on this server yet.' };
    if (!conn.linked) return { ok: false, configured: false, url: conn.serverUrl, error: 'Connect your Immich account in Settings → Immich connection.' };
    try {
      const c = clientForUser(me.userId);
      await c.get('/api/server/ping');
      return {
        ok: true,
        configured: true,
        url: conn.serverUrl,
        user: conn.immichUser ?? undefined,
        scopesVerified: conn.scopesVerified,
        warning: conn.scopesVerified ? undefined : 'Your key’s permissions could not be verified automatically.',
      };
    } catch (e: any) {
      return { ok: false, configured: true, url: conn.serverUrl, error: e?.message ?? String(e) };
    }
  });

  const metadataSearch = async (userId: string, body: Record<string, unknown>, page: number): Promise<PhotoPage> => {
    const res = await clientForUser(userId).search<SearchResponse>('metadata', { type: 'IMAGE', withExif: true, order: 'desc', size: PAGE_SIZE, page, ...body });
    return { items: res.assets.items.filter((a) => a.type === 'IMAGE').map(assetToItem), nextPage: res.assets.nextPage ?? null, total: res.assets.total };
  };

  app.get('/api/immich/albums', async (req): Promise<ImmichAlbum[]> => {
    const c = clientForUser(userOf(req).userId);
    type A = { id: string; albumName: string; assetCount: number; albumThumbnailAssetId: string | null; shared?: boolean };
    const [own, shared] = await Promise.all([c.get<A[]>('/api/albums'), c.get<A[]>('/api/albums?shared=true').catch(() => [] as A[])]);
    const seen = new Set<string>();
    return [...own, ...shared]
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
      .map((a) => ({ id: a.id, name: a.albumName, count: a.assetCount, thumbnailAssetId: a.albumThumbnailAssetId, shared: !!a.shared }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string } }>('/api/immich/albums/:id/assets', async (req): Promise<PhotoPage> => {
    const me = userOf(req);
    const id = assertId(req.params.id);
    const page = Math.max(1, Number(req.query.page ?? 1));
    try {
      return await metadataSearch(me.userId, { albumIds: [id] }, page);
    } catch {
      const album = await clientForUser(me.userId).get<{ assets?: ImmichAsset[] }>(`/api/albums/${id}?withoutAssets=false`);
      const all = (album.assets ?? []).filter((a) => a.type === 'IMAGE');
      const slice = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      return { items: slice.map(assetToItem), nextPage: page * PAGE_SIZE < all.length ? String(page + 1) : null, total: all.length };
    }
  });

  app.get('/api/immich/people', async (req): Promise<ImmichPerson[]> => {
    const c = clientForUser(userOf(req).userId);
    const res = await c.get<{ people: Array<{ id: string; name: string; isHidden?: boolean }> }>('/api/people?withHidden=false&size=1000');
    return res.people
      .filter((p) => !p.isHidden)
      .map((p) => ({ id: p.id, name: p.name || '', thumbnailUrl: `/api/immich/people/${p.id}/thumbnail` }))
      .sort((a, b) => (a.name && !b.name ? -1 : !a.name && b.name ? 1 : a.name.localeCompare(b.name)));
  });

  app.get<{ Params: { id: string } }>('/api/immich/people/:id/thumbnail', async (req, reply) => {
    const me = userOf(req);
    const id = assertId(req.params.id);
    const bucket = userCacheBucket(me.userId, 'immich-people');
    const key = `person:${id}`;
    let p = await cacheGet(bucket, key, 'jpg');
    if (!p) {
      p = await once(`${me.userId}:${key}`, async () => {
        const res = await clientForUser(me.userId).getBinary(`/api/people/${id}/thumbnail`);
        if (!res.ok) throw httpError(404, 'Person thumbnail unavailable');
        return cachePut(bucket, key, 'jpg', Buffer.from(await res.arrayBuffer()));
      });
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('image/jpeg').send(createReadStream(p!));
  });

  /** Favorites / person / year / month browsing (all via read-only metadata search). */
  app.get<{ Querystring: { filter?: string; page?: string } }>('/api/immich/assets', async (req): Promise<PhotoPage> => {
    const me = userOf(req);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const filter = String(req.query.filter ?? 'recent');
    const body: Record<string, unknown> = {};
    if (filter === 'favorites') body.isFavorite = true;
    else if (filter.startsWith('person:')) body.personIds = [assertId(filter.slice(7))];
    else if (filter.startsWith('people:')) body.personIds = filter.slice(7).split(',').slice(0, 10).map(assertId);
    else if (/^year:\d{4}$/.test(filter)) {
      const y = Number(filter.slice(5));
      body.takenAfter = `${y}-01-01T00:00:00.000Z`;
      body.takenBefore = `${y + 1}-01-01T00:00:00.000Z`;
    } else if (/^month:\d{4}-\d{2}$/.test(filter)) {
      const [y, m] = filter.slice(6).split('-').map(Number);
      body.takenAfter = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      body.takenBefore = new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1)).toISOString();
    }
    return metadataSearch(me.userId, body, page);
  });

  /** Years that have photos: the newest and oldest asset bound the range (2 search calls). */
  app.get('/api/immich/timeline', async (req): Promise<TimelineBucket[]> => {
    const c = clientForUser(userOf(req).userId);
    const year = async (order: 'asc' | 'desc') => {
      const r = await c.search<SearchResponse>('metadata', { type: 'IMAGE', order, size: 1, page: 1 });
      const a = r.assets.items[0];
      const d = a?.localDateTime ?? a?.fileCreatedAt;
      return d ? Number(String(d).slice(0, 4)) : null;
    };
    const [newest, oldest] = await Promise.all([year('desc'), year('asc')]);
    const now = new Date().getFullYear();
    const hi = Math.min(now + 1, newest ?? now);
    const lo = Math.max(1900, Math.min(hi, oldest ?? hi - 24));
    const out: TimelineBucket[] = [];
    for (let y = hi; y >= lo && out.length < 120; y--) out.push({ key: String(y), label: String(y) });
    return out;
  });

  app.post<{ Body: { query?: string; page?: number; personIds?: string[] } }>('/api/immich/search', async (req): Promise<PhotoPage> => {
    const c = clientForUser(userOf(req).userId);
    const query = String(req.body?.query ?? '').trim().slice(0, 300);
    if (!query) return { items: [], nextPage: null };
    const page = Math.max(1, Number(req.body?.page ?? 1));
    const body: Record<string, unknown> = { query, type: 'IMAGE', page, size: PAGE_SIZE, withExif: true };
    if (Array.isArray(req.body?.personIds) && req.body.personIds.length) body.personIds = req.body.personIds.slice(0, 10).map(assertId);
    try {
      const res = await c.search<SearchResponse>('smart', body);
      return { items: res.assets.items.filter((a) => a.type === 'IMAGE').map(assetToItem), nextPage: res.assets.nextPage ?? null, total: res.assets.total };
    } catch (e: any) {
      // Smart search disabled (no machine learning) — fall back to filename search.
      const res = await c.search<SearchResponse>('metadata', { originalFileName: query, type: 'IMAGE', page, size: PAGE_SIZE, withExif: true }).catch(() => null);
      if (!res) throw e;
      return { items: res.assets.items.map(assetToItem), nextPage: res.assets.nextPage ?? null, total: res.assets.total };
    }
  });
}
