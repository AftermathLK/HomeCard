import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { servedSize } from '../src/stock/served-size';

const DAY = 24 * 3600_000;

test('Openverse print size is capped to what the source URL really serves', () => {
  // StockSnap: Openverse reports the original but links the 960 px-wide thumbnail.
  assert.deepEqual(servedSize('https://cdn.stocksnap.io/img-thumbs/960w/TTSKFGC6G1.jpg', 6016, 4016), { width: 960, height: 641 });
  assert.deepEqual(servedSize('https://cdn.stocksnap.io/img-thumbs/960w/TK0EAXM5JR.jpg', 4000, 6000), { width: 960, height: 1440 });
  // Flickr size suffixes cap the longest side.
  assert.deepEqual(servedSize('https://live.staticflickr.com/65535/51750931566_4eda927886_b.jpg', 3024, 4032), { width: 768, height: 1024 });
  assert.deepEqual(servedSize('https://live.staticflickr.com/65535/1_abc_k.jpg?x=1', 6000, 4000), { width: 2048, height: 1365 });
  // Already small enough, originals and unknown hosts are left alone.
  assert.deepEqual(servedSize('https://live.staticflickr.com/65535/51750931566_4eda927886_b.jpg', 963, 1024), { width: 963, height: 1024 });
  assert.deepEqual(servedSize('https://live.staticflickr.com/65535/1_abc_o.jpg', 6000, 4000), { width: 6000, height: 4000 });
  assert.deepEqual(servedSize('https://upload.wikimedia.org/wikipedia/commons/a/ab/Snow.jpg', 5000, 3000), { width: 5000, height: 3000 });
  assert.deepEqual(servedSize('', 0, 0), { width: 0, height: 0 });
});

test('stock thumbnails expire 24 hours after download, however often they are viewed', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-stock-cache-'));
  const { cacheGet, cachePath, purgeCacheBucket } = await import('../src/util/cache');
  const put = (key: string, ageMs: number) => {
    const p = cachePath('stock-thumbs', key, 'jpg');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(p, t, t);
    return p;
  };

  const fresh = put('fresh', DAY - 60_000);
  assert.equal(await cacheGet('stock-thumbs', 'fresh', 'jpg', { maxAgeMs: DAY }), fresh);
  // Reading it doesn't make it younger.
  assert.ok(Date.now() - fs.statSync(fresh).mtimeMs > DAY - 120_000);

  const stale = put('stale', DAY + 60_000);
  assert.equal(await cacheGet('stock-thumbs', 'stale', 'jpg', { maxAgeMs: DAY }), null);
  assert.equal(fs.existsSync(stale), false);

  const old = put('old', DAY + 60_000);
  assert.equal(await purgeCacheBucket('stock-thumbs', DAY), 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});
