import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';
import { ImmichWriteBlockedError, ReadOnlyImmichClient, type FetchLike } from '../src/immich/readonly';
import { findImageMetadata, findPdfMetadata, scrubImage, scrubPdf } from '../src/render/privacy';
import { renderPathAllowed } from '../src/render/grants';
import { initKeys, open, seal, SecretConfigError } from '../src/security/keys';
import { hashPassword, passwordProblem, verifyPassword } from '../src/security/passwords';
import { cleanCss, sanitizeSvg } from '../src/styles/sanitize';
import { BlockedRequestError, isPublicAddress, safeGet } from '../src/stock/net';

const ID = '3f1c2a4e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const SRC = path.resolve(import.meta.dirname, '..', 'src');

/* ------------------------------------------------------------------ */
/* Layer 1: ReadOnlyImmichClient never lets a write leave the server   */
/* ------------------------------------------------------------------ */

function spyFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch };
}

test('ReadOnlyImmichClient exposes no method that could write', () => {
  const proto = Object.getOwnPropertyNames(ReadOnlyImmichClient.prototype).sort();
  assert.deepEqual(proto, ['constructor', 'get', 'getBinary', 'probe', 'search']);
  for (const m of ['delete', 'put', 'patch', 'post', 'request', 'fetch', 'send']) assert.equal((ReadOnlyImmichClient.prototype as any)[m], undefined, m);
});

test('blocked Immich requests throw before anything is sent', async () => {
  const { calls, fetch } = spyFetch();
  const blocked: string[] = [];
  const c = new ReadOnlyImmichClient('http://immich.local:2283', 'secret-key', { fetch, onBlocked: (r) => blocked.push(r) });
  const attempts: Array<() => Promise<unknown>> = [
    () => c.get('/api/assets'),
    () => c.get('/api/admin/users'),
    () => c.get(`/api/albums/${ID}/../../admin/users`),
    () => c.get('/api/albums/%2e%2e/users'),
    () => c.getBinary('/api/trash/empty'),
    () => c.probe('/api/users'),
    () => c.get('http://evil.example/api/albums'),
    () => c.search('explore' as any, {}),
    () => (c as any).search('metadata?x=1', {}),
  ];
  for (const a of attempts) await assert.rejects(a, ImmichWriteBlockedError);
  assert.equal(calls.length, 0, 'fetch must never be called for a blocked request');
  assert.equal(blocked.length, attempts.length);
});

test('mutating methods cannot be smuggled through the client', async () => {
  const { calls, fetch } = spyFetch();
  const c = new ReadOnlyImmichClient('http://immich.local:2283', 'secret-key', { fetch });
  // Even a caller reaching for the private choke point by name gets nothing.
  assert.equal((c as any)['#send'], undefined);
  assert.equal((c as any).send, undefined);
  // Prototype pollution of the request method is ignored: the method is decided inside the client.
  const body = { method: 'DELETE', ids: [ID] } as Record<string, unknown>;
  await c.search('metadata', body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url, 'http://immich.local:2283/api/search/metadata');
});

test('allowed reads go out as GET with the key only in x-api-key and no redirects', async () => {
  const { calls, fetch } = spyFetch();
  const c = new ReadOnlyImmichClient('http://immich.local:2283/', 'secret-key', { fetch });
  await c.get(`/api/albums/${ID}`);
  await c.getBinary(`/api/assets/${ID}/thumbnail?size=preview`);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'manual');
    assert.equal((call.init.headers as Record<string, string>)['x-api-key'], 'secret-key');
    assert.ok(!call.url.includes('secret-key'));
  }
});

test('a redirect from Immich is refused (the key never follows it)', async () => {
  const fetch: FetchLike = async () => new Response(null, { status: 302, headers: { location: 'http://elsewhere.local/' } });
  const c = new ReadOnlyImmichClient('http://immich.local:2283', 'k', { fetch });
  await assert.rejects(() => c.get('/api/albums'), /redirect/);
});

test('no server module talks to Immich except through ReadOnlyImmichClient', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts')) {
        const rel = path.relative(SRC, abs).replace(/\\/g, '/');
        const src = fs.readFileSync(abs, 'utf8');
        if (rel !== 'immich/readonly.ts' && /x-api-key/i.test(src)) offenders.push(`${rel}: sends x-api-key`);
        if (rel !== 'immich/readonly.ts' && /\bfetch\s*\(/.test(src)) offenders.push(`${rel}: calls fetch()`);
        if (/method:\s*['"](DELETE|PUT|PATCH)['"]/i.test(src)) offenders.push(`${rel}: mutating HTTP method`);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});

/* ------------------------------------------------------------------ */
/* Secrets: AES-256-GCM credentials, Argon2id passwords                */
/* ------------------------------------------------------------------ */

test('encryption key is required, long enough and not a placeholder', () => {
  const base = { sessionSecret: '', isDev: false, devKeyFile: path.join(os.tmpdir(), 'hc-unused.key') };
  assert.throws(() => initKeys({ ...base, encryptionKey: '' }), SecretConfigError);
  assert.throws(() => initKeys({ ...base, encryptionKey: 'short' }), SecretConfigError);
  assert.throws(() => initKeys({ ...base, encryptionKey: 'changeme' }), SecretConfigError);
  assert.throws(() => initKeys({ ...base, encryptionKey: 'x'.repeat(40), sessionSecret: 'too-short' }), SecretConfigError);
});

test('Immich keys are sealed with AES-256-GCM bound to the user id', () => {
  initKeys({ encryptionKey: 'test-key-'.repeat(6), sessionSecret: '', isDev: false, devKeyFile: '' });
  const sealed = seal('immich-api-key-abcdef', 'u_aaaaaaaaaaaaaaaaaa');
  assert.ok(!Buffer.from(sealed.ciphertext).toString('utf8').includes('immich-api-key'));
  assert.equal(sealed.iv.length, 12);
  assert.equal(sealed.tag.length, 16);
  assert.equal(open(sealed, 'u_aaaaaaaaaaaaaaaaaa'), 'immich-api-key-abcdef');
  // Copying another user's ciphertext into your row doesn't decrypt (AAD = user id).
  assert.throws(() => open(sealed, 'u_bbbbbbbbbbbbbbbbbb'));
  const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  assert.throws(() => open(tampered, 'u_aaaaaaaaaaaaaaaaaa'));
  // Same plaintext twice → different IV and ciphertext.
  const again = seal('immich-api-key-abcdef', 'u_aaaaaaaaaaaaaaaaaa');
  assert.notDeepEqual(Buffer.from(again.iv), Buffer.from(sealed.iv));
});

test('passwords are hashed with Argon2id and checked against policy', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('correct horse batterz', h), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('password123'));
  assert.ok(passwordProblem('aaaaaaaaaaaa'));
  assert.ok(passwordProblem('rivera-family-2026', 'rivera'));
  assert.equal(passwordProblem('snowy pine cabin', 'rivera'), null);
});

/* ------------------------------------------------------------------ */
/* SVG sanitizer                                                       */
/* ------------------------------------------------------------------ */

test('SVG sanitizer strips scripts, handlers, foreign content and external references', () => {
  const evil = `<?xml version="1.0"?>
<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50" onload="alert(1)">
  <script>alert(2)</script>
  <script href="https://evil.example/x.js"/>
  <foreignObject><iframe src="file:///etc/passwd"></iframe></foreignObject>
  <image href="file:///etc/passwd" width="10" height="10"/>
  <image xlink:href="http://192.168.1.1/admin.png" width="10" height="10"/>
  <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
  <use href="https://evil.example/sprite.svg#a"/>
  <a href="javascript:alert(3)"><rect id="r" width="10" height="10" fill="url(#g)" onclick="alert(4)" style="fill:url(http://evil.example/x);stroke:red"/></a>
  <animate attributeName="href" to="javascript:alert(5)"/>
  <set attributeName="onload" to="alert(6)"/>
  <linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>
  <style>@import url(https://evil.example/x.css); rect { fill: url('https://evil.example/y'); stroke: url(#g) }</style>
  <text>&xxe;</text>
  <inkscape:namedview xmlns:inkscape="x"/>
</svg>`;
  const out = sanitizeSvg(evil, 'test');
  for (const bad of ['<script', 'onload', 'onclick', 'foreignObject', 'iframe', 'file:', 'http://192', 'evil.example', 'javascript', '<animate', '<set', '@import', 'ENTITY', 'inkscape', '<a ']) {
    assert.ok(!out.includes(bad), `output still contains ${bad}:\n${out}`);
  }
  assert.ok(out.includes('data:image/png;base64,iVBORw0KGgo='), 'embedded raster images are kept');
  assert.match(out, /<rect id="hc[0-9a-f]{6}_r"/, 'ids are namespaced');
  assert.match(out, /fill="url\(#hc[0-9a-f]{6}_g\)"/, 'local references follow the namespaced ids');
  assert.match(out, /viewBox="0 0 100 50"/);
  assert.match(out, /^<svg[^>]*width="100%" height="100%"/);
  assert.throws(() => sanitizeSvg('<html><body>nope</body></html>', 'x'));
});

test('CSS cleaner removes every way of loading something external', () => {
  const css = cleanCss('a{background:u\\72l(http://x)} b{behavior:url(x.htc)} c{fill:url("#ok")} @import "y.css"; d{background:image-set("z.png" 1x)}');
  assert.ok(!/http|\.htc|y\.css|z\.png|behavior/i.test(css), css);
  assert.ok(css.includes('url(#ok)'));
});

/* ------------------------------------------------------------------ */
/* EXIF / GPS / PDF metadata scrubbing                                 */
/* ------------------------------------------------------------------ */

test('JPEG export scrub removes EXIF (GPS, camera serial, dates) and XMP but keeps DPI and ICC', async () => {
  const img = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } })
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'Serial-12345', DateTime: '2026:11:22 10:00:00', Software: 'Editor 9' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '44/1 58/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '93/1 15/1 0/1' },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>')
    .withMetadata({ density: 300 })
    .withIccProfile('srgb')
    .jpeg({ quality: 90 })
    .toBuffer();
  const before = findImageMetadata(img);
  assert.ok(before.includes('EXIF'), `fixture should carry EXIF (${before})`);
  // libvips keeps the 300 DPI in EXIF; without the dpi argument it would fall back to 72.
  assert.equal((await sharp(scrubImage(img)).metadata()).density, 72);
  const clean = scrubImage(img, 300);
  assert.deepEqual(findImageMetadata(clean), []);
  const meta = await sharp(clean).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.xmp, undefined);
  assert.equal(meta.density, 300, 'DPI is moved into the JFIF header');
  assert.ok(meta.icc, 'ICC profile must survive');
  assert.ok(!clean.includes(Buffer.from('TestCam')));
  assert.ok(!clean.includes(Buffer.from('Serial-12345')));
  assert.equal((await sharp(clean).raw().toBuffer()).length, 64 * 48 * 3, 'image data intact');
});

test('PNG export scrub removes eXIf/text/time chunks but keeps pHYs', async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00f8' } })
    .withExif({ IFD0: { Make: 'TestCam', Software: 'Editor 9' } })
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
  const clean = scrubImage(png);
  assert.deepEqual(findImageMetadata(clean), []);
  const meta = await sharp(clean).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.density, 300);
  assert.ok(!clean.includes(Buffer.from('TestCam')));
});

test('PDF scrub leaves only the title: no dates, Creator/Producer or XMP', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([360, 504]);
  doc.setTitle('Rivera Christmas');
  doc.setAuthor('Someone');
  doc.setCreator('Chromium');
  doc.setProducer('Skia/PDF m140');
  doc.setCreationDate(new Date('2026-11-22T10:00:00Z'));
  doc.setModificationDate(new Date('2026-11-22T10:00:00Z'));
  const xmp = doc.context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/">GPS 44.9</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
  scrubPdf(doc, 'Rivera Christmas');
  const bytes = await doc.save({ useObjectStreams: false });
  const raw = Buffer.from(bytes).toString('latin1');
  for (const bad of ['Skia', 'Chromium', 'Someone', 'CreationDate', 'ModDate', 'xmpmeta', 'GPS 44.9', 'pdf-lib']) assert.ok(!raw.includes(bad), `PDF still contains ${bad}`);
  const back = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.deepEqual(findPdfMetadata(bytes, back), []);
  assert.equal(back.getTitle(), 'Rivera Christmas');
  void PDFString;
});

/* ------------------------------------------------------------------ */
/* Stock downloads: SSRF protection                                    */
/* ------------------------------------------------------------------ */

test('only public addresses are reachable', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.20', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '151.101.1.69', '2606:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
});

test('stock fetches refuse private hosts, other domains, odd schemes and ports', async () => {
  const o = { hosts: ['pixabay.com'], maxBytes: 1024 };
  for (const url of ['http://127.0.0.1/', 'https://192.168.1.20/api', 'https://evil.example/x.jpg', 'https://pixabay.com.evil.example/', 'file:///etc/passwd', 'ftp://pixabay.com/x', 'https://user:pw@pixabay.com/', 'https://pixabay.com:8443/']) {
    await assert.rejects(() => safeGet(url, o), BlockedRequestError, url);
  }
  await assert.rejects(() => safeGet('http://[::1]/', { hosts: '*', maxBytes: 1024, allowHttp: true }), BlockedRequestError);
  await assert.rejects(() => safeGet('http://10.1.2.3/', { hosts: '*', maxBytes: 1024, allowHttp: true }), BlockedRequestError);
});

/* ------------------------------------------------------------------ */
/* Render grants                                                       */
/* ------------------------------------------------------------------ */

test('the headless renderer can only read what printing needs', () => {
  for (const p of ['/render.html', '/api/media/print', '/api/fonts/fonts.css', '/api/styles/file/x/y.svg', '/api/stock/file/a.jpg']) assert.equal(renderPathAllowed(p), true, p);
  for (const p of ['/', '/api/projects', '/api/exports', '/api/admin/users', '/api/me/immich', '/api/immich/albums', '/api/auth/me', '/api/library', '/api/uploads']) assert.equal(renderPathAllowed(p), false, p);
});

test('error responses are never cacheable, and Immich derivatives are re-encoded before caching', () => {
  // Routes set Cache-Control before doing work that can fail; a cached 502 once hid a recovered provider.
  const index = fs.readFileSync(path.join(SRC, 'index.ts'), 'utf8');
  const handler = index.slice(index.indexOf('app.setErrorHandler'), index.indexOf('app.setErrorHandler') + 400);
  assert.match(handler, /reply\.header\('Cache-Control', 'no-store'\)/);
  // Immich thumbnails/previews can carry EXIF/GPS: the cache must store a re-encoded copy, never the raw bytes.
  const sources = fs.readFileSync(path.join(SRC, 'media', 'sources.ts'), 'utf8');
  const derivative = sources.slice(sources.indexOf('async function immichDerivative'), sources.indexOf('async function immichFull'));
  assert.match(derivative, /sharp\(/);
  assert.doesNotMatch(derivative, /cachePut\([^)]*arrayBuffer/);
});
