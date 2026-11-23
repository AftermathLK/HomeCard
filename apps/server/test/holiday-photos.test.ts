import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { discoverHolidayPhotos, listImmichTags, type ImmichTag } from '../src/immich/discovery';
import { cachedPhotos, invalidateUserPhotos, PHOTO_CACHE_TTL_MS, storePhotos } from '../src/immich/photoCache';
import { ImmichWriteBlockedError, ReadOnlyImmichClient, type FetchLike } from '../src/immich/readonly';

/*
 * "See pictures from this time" against a fake Immich that records every request: it must only
 * ever read, cope with a key that lacks the optional tag.read permission, and never suggest
 * trashed, archived, hidden or video assets.
 */

const NOW = new Date(2026, 10, 23, 12); // Monday Nov 23 2026, local time
const TAG = '0b6f3c1e-1111-4222-8333-444444444444';
const OTHER_TAG = '0b6f3c1e-1111-4222-8333-555555555555';
const MY_TAG = '0b6f3c1e-1111-4222-8333-666666666666';
const ALBUM = '7d2e9a10-aaaa-4bbb-8ccc-000000000001';
const OTHER_ALBUM = '7d2e9a10-aaaa-4bbb-8ccc-000000000002';
const ID = '3f1c2a4e-1b2c-4d5e-8f90-a1b2c3d4e5f6';

const asset = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'IMAGE', originalFileName: `${id}.jpg`, localDateTime: '2025-12-20T10:00:00.000Z', isFavorite: false, ...over });
const ASSETS = {
  past: asset('past-2025'),
  trashed: asset('trashed', { isTrashed: true }),
  archivedOld: asset('archived-old', { isArchived: true }),
  archivedNew: asset('archived-new', { visibility: 'archive' }),
  locked: asset('locked', { visibility: 'locked' }),
  video: asset('video', { type: 'VIDEO' }),
  recentFav: asset('recent-fav', { isFavorite: true, localDateTime: '2026-11-01T09:00:00.000Z' }),
  recent: asset('recent', { localDateTime: '2026-11-10T09:00:00.000Z' }),
  album: asset('album-only', { localDateTime: '2024-12-24T18:00:00.000Z' }),
  mine: asset('my-pick', { localDateTime: '2023-12-01T18:00:00.000Z' }),
  visual: asset('visual-1', { localDateTime: '2022-07-01T12:00:00.000Z' }),
};
const BAD = ['trashed', 'archived-old', 'archived-new', 'locked', 'video'];

interface Call {
  method: string;
  path: string;
  body?: any;
}

function fakeImmich(opts: { tags: 'forbidden' | ImmichTag[]; albums?: Array<{ id: string; albumName: string; assetCount?: number }>; down?: boolean }) {
  const calls: Call[] = [];
  const page = (items: unknown[]) => ({ assets: { items, nextPage: null } });
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = String(init.method);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname + u.search, body });
    if (opts.down) return json({ message: 'boom' }, 500);
    if (method === 'GET' && u.pathname === '/api/tags') {
      return opts.tags === 'forbidden' ? json({ message: 'Missing required permission: tag.read', statusCode: 403 }, 403) : json(opts.tags);
    }
    if (method === 'GET' && u.pathname === '/api/albums') return json(u.search.includes('shared=true') ? [] : (opts.albums ?? []));
    if (method === 'POST' && u.pathname === '/api/search/metadata') {
      if (body.tagIds) return json(page(body.tagIds.includes(TAG) ? [ASSETS.past] : body.tagIds.includes(MY_TAG) ? [ASSETS.mine] : []));
      if (body.albumIds) return json(page(body.albumIds.includes(ALBUM) ? [ASSETS.album] : []));
      if (body.takenBefore) {
        // Only the window around Christmas 2025 has photos (plus things that must be filtered out).
        return json(page(String(body.takenAfter).startsWith('2025-1') ? [ASSETS.past, ASSETS.trashed, ASSETS.archivedOld, ASSETS.archivedNew, ASSETS.locked, ASSETS.video] : []));
      }
      if (body.isFavorite) return json(page([ASSETS.recentFav]));
      return json(page([ASSETS.recentFav, ASSETS.recent, ASSETS.video]));
    }
    if (method === 'POST' && u.pathname === '/api/search/smart') return json(page([ASSETS.visual, ASSETS.trashed]));
    return json({ message: 'Not found' }, 404);
  };
  return { calls, client: new ReadOnlyImmichClient('http://immich.local:2283', 'test-key', { fetch }) };
}

function assertOnlyReads(calls: Call[]) {
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.ok(c.method === 'GET' || c.method === 'POST', `${c.method} ${c.path}`);
    if (c.method === 'POST') assert.match(c.path, /^\/api\/search\/(metadata|smart)$/, `POST ${c.path}`);
    assert.ok(!/^\/api\/tags\/.+/.test(c.path) || c.method === 'GET', `${c.method} ${c.path}`);
  }
}

test('a key without tag.read: tags are skipped with a missing-scope note, dates still find photos', async () => {
  const { calls, client } = fakeImmich({ tags: 'forbidden' });
  const r = await discoverHolidayPhotos(client, { occasionId: 'christmas', now: NOW });
  assert.deepEqual(r.missingScopes, ['tag.read']);
  assert.equal(r.date, '2026-12-25');
  const ids = r.items.map((i) => i.ref.replace('immich:', ''));
  assert.ok(ids.includes('past-2025'), 'past-year window still works');
  assert.ok(ids.includes('recent-fav') && ids.includes('recent'));
  for (const bad of BAD) assert.ok(!ids.includes(bad), `${bad} must never be suggested`);
  assert.equal(new Set(ids).size, ids.length, 'deduplicated');
  const past = r.items.find((i) => i.ref === 'immich:past-2025')!;
  assert.deepEqual(past.kinds, ['past']);
  assert.deepEqual(past.reasons, ['Dec 2025']);
  assert.equal(r.items.find((i) => i.ref === 'immich:recent-fav')!.reasons[0], 'Recent favorite');
  // Fewer than 8 found: visual search fills in.
  assert.equal(r.signals.visual, true);
  assert.deepEqual(r.items.find((i) => i.ref === 'immich:visual-1')!.reasons, ['Visual match']);
  assert.deepEqual(r.signals.pastYears, [2025, 2024, 2023, 2022]);
  assert.ok(!calls.some((c) => c.body?.tagIds), 'no tag searches without tag.read');
  assertOnlyReads(calls);
});

test('a key with tag.read: matching tags (and the person’s own tag names) are searched by tagIds', async () => {
  const { calls, client } = fakeImmich({
    tags: [
      { id: TAG, name: 'Christmas', value: 'Holidays/Christmas' },
      { id: OTHER_TAG, name: 'Eastern trip', value: 'Trips/Eastern trip' },
      { id: MY_TAG, name: 'card-picks', value: 'card-picks' },
    ],
    albums: [
      { id: ALBUM, albumName: 'Christmas 2024', assetCount: 12 },
      { id: OTHER_ALBUM, albumName: 'Eastern Europe', assetCount: 40 },
    ],
  });
  const r = await discoverHolidayPhotos(client, { occasionId: 'christmas', customTags: ['card-picks'], now: NOW });
  assert.deepEqual(r.missingScopes, []);
  const tagSearches = calls.filter((c) => c.body?.tagIds).map((c) => c.body.tagIds);
  assert.deepEqual(tagSearches.sort(), [[MY_TAG], [TAG]].sort());
  assert.ok(!tagSearches.flat().includes(OTHER_TAG), '"Eastern trip" is not Christmas');
  const albumSearches = calls.filter((c) => c.body?.albumIds).map((c) => c.body.albumIds);
  assert.deepEqual(albumSearches, [[ALBUM]]);
  assert.deepEqual(r.signals.tags.sort(), ['Christmas', 'card-picks'].sort());
  assert.deepEqual(r.signals.albums, ['Christmas 2024']);
  // Found by tag AND by date: one entry, both reasons, ranked first.
  const top = r.items[0];
  assert.equal(top.ref, 'immich:past-2025');
  assert.deepEqual(top.kinds.sort(), ['past', 'tag']);
  assert.deepEqual(top.reasons, ['Tag: Christmas', 'Dec 2025']);
  assert.deepEqual(r.items.find((i) => i.ref === 'immich:my-pick')!.reasons, ['Tag: card-picks']);
  assert.deepEqual(r.items.find((i) => i.ref === 'immich:album-only')!.reasons, ['Album: Christmas 2024']);
  assertOnlyReads(calls);
});

test('known permissions without tag.read: /api/tags is not even asked', async () => {
  const { calls, client } = fakeImmich({ tags: [{ id: TAG, name: 'Christmas' }] });
  const r = await discoverHolidayPhotos(client, { occasionId: 'christmas', now: NOW, permissions: ['asset.read', 'album.read', 'asset.view'] });
  assert.deepEqual(r.missingScopes, ['tag.read']);
  assert.ok(!calls.some((c) => c.path.startsWith('/api/tags')));
  assert.ok(r.items.length > 0);
});

test('a big library: busy past-year windows cannot crowd recent photos out of the list', async () => {
  const many = (prefix: string, n: number, date: string) => Array.from({ length: n }, (_, i) => asset(`${prefix}-${i}`, { localDateTime: date }));
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const page = (items: unknown[]) => json({ assets: { items, nextPage: null } });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    if (u.pathname === '/api/tags' || u.pathname === '/api/albums') return json([]);
    if (u.pathname === '/api/search/metadata') {
      const from = String(body.takenAfter ?? '');
      if (body.takenBefore) return page(many(`past-${from.slice(0, 4)}`, 40, `${from.slice(0, 10)}T12:00:00.000Z`));
      if (body.isFavorite) return page([]);
      return page(many('recent', 40, '2026-11-10T12:00:00.000Z'));
    }
    return page([]);
  };
  const r = await discoverHolidayPhotos(new ReadOnlyImmichClient('http://immich.local:2283', 'k', { fetch }), { occasionId: 'christmas', now: NOW });
  assert.equal(r.items.length, 150, 'still capped');
  const recent = r.items.filter((i) => i.kinds.includes('recent')).length;
  assert.ok(recent >= 20, `recent photos kept: ${recent}`);
  assert.equal(r.items.filter((i) => i.kinds.includes('past')).length, 150 - recent);
  assert.ok(r.items.findIndex((i) => i.kinds.includes('recent')) > r.items.findIndex((i) => i.kinds.includes('past')), 'still ranked by score');
});

test('Immich unreachable: an error, not an empty drawer', async () => {
  const { client } = fakeImmich({ tags: [], down: true });
  await assert.rejects(() => discoverHolidayPhotos(client, { occasionId: 'easter', now: NOW }));
});

test('the tag list for Settings: sorted names with tag.read, a clear answer without it', async () => {
  const ok = await listImmichTags(fakeImmich({ tags: [{ id: TAG, name: 'Xmas', value: 'Holidays/Xmas' }, { id: MY_TAG, name: 'Beach', value: 'Beach' }] }).client);
  assert.deepEqual(ok, { available: true, tags: [{ name: 'Beach', value: 'Beach' }, { name: 'Xmas', value: 'Holidays/Xmas' }], missingScopes: [] });
  const denied = await listImmichTags(fakeImmich({ tags: 'forbidden' }).client);
  assert.deepEqual(denied, { available: false, tags: [], missingScopes: ['tag.read'] });
  const known = fakeImmich({ tags: [] });
  assert.deepEqual(await listImmichTags(known.client, ['asset.read']), { available: false, tags: [], missingScopes: ['tag.read'] });
  assert.equal(known.calls.length, 0);
});

test('the read-only client refuses every tag write before anything is sent', async () => {
  const { calls, client } = fakeImmich({ tags: [] });
  const c = client as any;
  for (const m of ['post', 'put', 'patch', 'delete', 'request']) assert.equal(c[m], undefined, `no ${m}() on the client`);
  const attempts: Array<() => Promise<unknown>> = [
    () => client.get('/api/tags/not-a-uuid'),
    () => client.get(`/api/tags/${ID}/assets`),
    () => client.getBinary('/api/tags/assets'),
    () => c.search('../tags', { name: 'x' }),
    () => c.search('../tags/assets', { tagIds: [TAG], assetIds: [ID] }),
  ];
  for (const a of attempts) await assert.rejects(a, ImmichWriteBlockedError);
  assert.equal(calls.length, 0, 'nothing reached Immich');
});

test('suggestion cache is per person, expires after 15 minutes and can be dropped', () => {
  const t0 = 1_000_000;
  storePhotos('user-a', ['upcoming', 'christmas', 'plain'], { n: 1 }, t0);
  storePhotos('user-b', ['upcoming', 'christmas', 'plain'], { n: 2 }, t0);
  assert.deepEqual(cachedPhotos('user-a', ['upcoming', 'christmas', 'plain'], t0 + 1)?.value, { n: 1 });
  assert.deepEqual(cachedPhotos('user-b', ['upcoming', 'christmas', 'plain'], t0 + 1)?.value, { n: 2 });
  assert.equal(cachedPhotos('user-a', ['upcoming', 'easter', 'plain'], t0 + 1), null);
  assert.equal(cachedPhotos('user-a', ['upcoming', 'christmas', 'plain'], t0 + PHOTO_CACHE_TTL_MS + 1), null, 'expired');
  invalidateUserPhotos('user-b');
  assert.equal(cachedPhotos('user-b', ['upcoming', 'christmas', 'plain'], t0 + 1), null);
  // A user id that is a prefix of another doesn't wipe theirs.
  storePhotos('user-1', ['x'], 1, t0);
  storePhotos('user-10', ['x'], 10, t0);
  invalidateUserPhotos('user-1');
  assert.equal(cachedPhotos('user-10', ['x'], t0 + 1)?.value, 10);
});

test('holiday routes only ever act for the signed-in person', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'holidays', 'routes.ts'), 'utf8');
  const handlers = src.split(/app\.(?:get|put|post|delete)\b/).slice(1);
  assert.equal(handlers.length, 4);
  for (const h of handlers) assert.match(h, /userOf\(req\)/);
  assert.doesNotMatch(src, /app\.(post|delete|patch)\(/);
  // Key changes drop cached suggestions.
  const immichRoutes = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'immich', 'routes.ts'), 'utf8');
  assert.ok((immichRoutes.match(/invalidateUserPhotos\(/g) ?? []).length >= 2);
});
