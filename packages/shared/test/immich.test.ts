import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeImmichScopes,
  checkImmichRequest,
  IMMICH_GET_ALLOWLIST,
  IMMICH_MUTATING_METHODS,
  IMMICH_OPTIONAL_SCOPES,
  IMMICH_POST_ALLOWLIST,
  IMMICH_REQUIRED_SCOPES,
} from '../src/immich';

const ID = '3f1c2a4e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const fill = (route: string) => route.replace(/:id/g, ID);

test('Layer 1: every allowlisted GET route is allowed', () => {
  for (const r of IMMICH_GET_ALLOWLIST) {
    const c = checkImmichRequest('GET', fill(r));
    assert.equal(c.ok, true, `GET ${r} should be allowed`);
  }
  assert.equal(checkImmichRequest('GET', `/api/assets/${ID}/thumbnail?size=preview`).ok, true);
});

test('Layer 1: the three read-only search POSTs are allowed', () => {
  for (const r of IMMICH_POST_ALLOWLIST) assert.equal(checkImmichRequest('POST', r).ok, true, r);
});

test('Layer 1: DELETE, PUT and PATCH are fatal on every path, allowlisted or not', () => {
  const paths = [...IMMICH_GET_ALLOWLIST.map(fill), ...IMMICH_POST_ALLOWLIST, '/api/assets', `/api/albums/${ID}/assets`, '/api/trash/empty', '/api/admin/users'];
  for (const m of [...IMMICH_MUTATING_METHODS, 'delete', 'Put', 'patch']) {
    for (const p of paths) {
      const c = checkImmichRequest(m, p);
      assert.equal(c.ok, false, `${m} ${p} must be blocked`);
      assert.equal(!c.ok && c.fatal, true);
      assert.match(!c.ok ? c.reason : '', /never modifies or deletes/);
    }
  }
});

test('Layer 1: other methods are blocked', () => {
  for (const m of ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT', '', 'PROPFIND']) assert.equal(checkImmichRequest(m, '/api/albums').ok, false, m);
});

test('Layer 1: anything not on the allowlist is blocked', () => {
  const blocked: Array<[string, string]> = [
    ['GET', '/api/assets'], // bulk listing is not allowlisted
    ['GET', '/api/timeline/buckets'],
    ['GET', '/api/admin/users'],
    ['GET', '/api/server/config'],
    ['GET', '/api/users'],
    ['GET', '/api/shared-links'],
    ['GET', `/api/assets/${ID}/video/playback`],
    ['GET', '/api/albums/not-a-uuid'],
    ['GET', `/api/albums/${ID}/../../admin/users`],
    ['GET', '/api/albums/%2e%2e/users'],
    ['GET', `/api/assets/${ID}//original`],
    ['GET', '/api\\albums'],
    ['GET', '/albums'],
    ['GET', 'http://evil.example/api/albums'],
    ['GET', '//evil.example/api/albums'],
    ['POST', '/api/assets'],
    ['POST', '/api/albums'],
    ['POST', `/api/albums/${ID}/assets`],
    ['POST', '/api/search/metadata?x=1'],
    ['POST', '/api/search/explore'],
    ['POST', '/api/trash/empty'],
    ['POST', '/api/jobs'],
    ['POST', '/api/api-keys'],
  ];
  for (const [m, p] of blocked) {
    const c = checkImmichRequest(m, p);
    assert.equal(c.ok, false, `${m} ${p} must be blocked`);
  }
});

test('Layer 2: dangerous key permissions are refused', () => {
  const cases = ['all', 'asset.delete', 'asset.upload', 'asset.update', 'album.create', 'album.write', 'adminUser.read', 'admin.user.create', 'person.merge', 'sharedLink.create', 'apiKey.create', 'library.update', 'tag.asset', 'memory.delete'];
  for (const p of cases) {
    const a = analyzeImmichScopes(['album.read', 'asset.read', p]);
    assert.deepEqual(a.dangerous, [p], p);
    assert.equal(a.readOnly, false, p);
  }
});

test('Layer 2: the guided read-only key passes and reports missing scopes', () => {
  const required = IMMICH_REQUIRED_SCOPES.map((s) => s.id);
  const ok = analyzeImmichScopes([...required, 'memory.read']);
  assert.deepEqual(ok.dangerous, []);
  assert.deepEqual(ok.missingRequired, []);
  assert.equal(ok.readOnly, true);
  const partial = analyzeImmichScopes(['album.read', 'asset.read']);
  assert.deepEqual(partial.dangerous, []);
  assert.ok(partial.missingRequired.includes('asset.download'));
  assert.ok(partial.missingOptional.includes('memory.read'));
});

test('Tags: the tag list and a single tag can be read', () => {
  assert.equal(checkImmichRequest('GET', '/api/tags').ok, true);
  assert.equal(checkImmichRequest('GET', `/api/tags/${ID}`).ok, true);
  assert.equal(checkImmichRequest('GET', '/api/tags/not-a-uuid').ok, false);
  assert.equal(checkImmichRequest('GET', `/api/tags/${ID}/../../admin/users`).ok, false);
});

test('Tags: creating, renaming, deleting and tagging assets are all blocked', () => {
  const writes: Array<[string, string]> = [
    ['POST', '/api/tags'], // create
    ['PUT', '/api/tags'], // upsert
    ['PUT', `/api/tags/${ID}`], // rename / recolour
    ['PATCH', `/api/tags/${ID}`],
    ['DELETE', `/api/tags/${ID}`],
    ['PUT', '/api/tags/assets'], // bulk tag assets
    ['POST', '/api/tags/assets'],
    ['PUT', `/api/tags/${ID}/assets`], // tag assets
    ['POST', `/api/tags/${ID}/assets`],
    ['DELETE', `/api/tags/${ID}/assets`], // untag assets
  ];
  for (const [m, p] of writes) {
    const c = checkImmichRequest(m, p);
    assert.equal(c.ok, false, `${m} ${p} must be blocked`);
    if (IMMICH_MUTATING_METHODS.includes(m as any)) assert.equal(!c.ok && c.fatal, true, `${m} ${p} is fatal`);
  }
});

test('Tags: tag.read is an optional, safe scope; every tag write scope is refused', () => {
  const required = IMMICH_REQUIRED_SCOPES.map((s) => s.id);
  assert.ok(IMMICH_OPTIONAL_SCOPES.some((s) => s.id === 'tag.read'));
  assert.ok(!required.includes('tag.read'), 'never required: discovery works without it');
  const withTags = analyzeImmichScopes([...required, 'tag.read']);
  assert.deepEqual(withTags.dangerous, []);
  assert.equal(withTags.readOnly, true);
  assert.ok(!withTags.missingOptional.includes('tag.read'));
  assert.ok(analyzeImmichScopes(required).missingOptional.includes('tag.read'));
  for (const p of ['tag.create', 'tag.update', 'tag.delete', 'tag.asset', 'all']) {
    const a = analyzeImmichScopes([...required, 'tag.read', p]);
    assert.deepEqual(a.dangerous, [p], p);
    assert.equal(a.readOnly, false, p);
  }
});
