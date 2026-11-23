import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import AdmZip from 'adm-zip';
import { planZipImport } from '../src/styles/zipimport';

const STYLES = path.resolve('/data/styles');
const manifest = (id: string) => JSON.stringify({ id, name: id, version: '1.0.0' });
const rels = (p: { files: Array<{ out: string }> }) => p.files.map((f) => path.relative(STYLES, f.out).split(path.sep).join('/')).sort();

function zipOf(files: Record<string, string>) {
  const z = new AdmZip();
  for (const [name, body] of Object.entries(files)) z.addFile(name, Buffer.from(body));
  return z.toBuffer();
}

test('a library zip imports every pack folder, and a nested pack.json stays with its pack', () => {
  const buf = zipOf({
    'layouts-a/pack.json': manifest('layouts-a'),
    'layouts-a/ornaments/frame.svg': '<svg viewBox="0 0 1 1"/>',
    'layouts-b/pack.json': manifest('layouts-b'),
    'layouts-b/extra/pack.json': manifest('nested'),
    'README.txt': 'not part of a pack',
  });
  const { planned, errors } = planZipImport(buf, 'lib.zip', STYLES);
  assert.deepEqual(errors, []);
  assert.deepEqual(planned.map((p) => p.id), ['layouts-a', 'layouts-b']);
  assert.deepEqual(rels(planned[0]), ['layouts-a/ornaments/frame.svg', 'layouts-a/pack.json']);
  assert.deepEqual(rels(planned[1]), ['layouts-b/extra/pack.json', 'layouts-b/pack.json']);
});

test('a single-pack zip still imports as one pack, files land under the pack id', () => {
  const { planned } = planZipImport(zipOf({ 'pack.json': manifest('my-pack'), 'textures/paper.png': 'x' }), 'p.zip', STYLES);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].dest, path.join(STYLES, 'my-pack'));
  assert.equal(planned[0].files.length, 2);
});

test('bad packs in a library are reported, the good ones still import', () => {
  const { planned, errors } = planZipImport(
    zipOf({ 'a/pack.json': manifest('ok-pack'), 'b/pack.json': manifest('my-uploads'), 'c/pack.json': '{oops', 'd/pack.json': manifest('ok-pack') }),
    'lib.zip',
    STYLES,
  );
  assert.deepEqual(planned.map((p) => p.id), ['ok-pack']);
  assert.equal(errors.length, 3);
  const all = errors.map((e) => e.error).join('\n');
  assert.match(all, /reserved/);
  assert.match(all, /Could not parse/);
  assert.match(all, /appears twice/);
});

test('zip-slip entries and zip bombs abort the whole import before anything is written', () => {
  const slip = new AdmZip();
  slip.addFile('good/pack.json', Buffer.from(manifest('good')));
  slip.addFile('evil/pack.json', Buffer.from(manifest('evil')));
  slip.addFile('evil/x.svg', Buffer.from('<svg/>'));
  // AdmZip normalises names on addFile, so write the traversal name into the entry directly.
  slip.getEntry('evil/x.svg')!.entryName = 'evil/../../../etc/x.svg';
  assert.throws(() => planZipImport(slip.toBuffer(), 'slip.zip', STYLES), /Unsafe path in zip/);

  const big = zipOf({ 'pack.json': manifest('big'), 'a.txt': 'x'.repeat(4096) });
  assert.throws(() => planZipImport(big, 'big.zip', STYLES, 1024), /expands to more than/);
});
