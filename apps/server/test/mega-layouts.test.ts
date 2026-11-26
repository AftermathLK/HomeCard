import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
// @ts-expect-error plain ESM script without type declarations
import { generate } from '../../../scripts/generate-mega-layouts.mjs';

test('the layout library generator builds valid, distinct, year-safe packs', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-mega-'));
  try {
    const res = generate({ perOccasion: 10, generic: 10, out, zip: null, review: null });
    assert.deepEqual(res.validation.errors, []);
    assert.equal(res.packs.length, 36);
    const generic = res.packs.filter((p: any) => p.id.startsWith('layouts-generic-'));
    assert.equal(generic.length, 7);
    for (const p of generic) {
      assert.equal(p.raw.templates.length, 10);
      assert.deepEqual(p.raw.occasions, []);
    }
    for (const p of res.packs.filter((pp: any) => !pp.id.startsWith('layouts-generic-'))) {
      assert.equal(p.raw.templates.length, 70, p.id);
      assert.equal(p.raw.occasions.length, 1);
      assert.equal(p.ornaments.length, 5);
    }
    // No layout carries a fixed year: every year comes from the {{year}} token.
    const text = fs.readdirSync(out).map((d) => fs.readFileSync(path.join(out, d, 'pack.json'), 'utf8')).join('\n');
    assert.doesNotMatch(text, /"text":"[^"]*\b(19|20)\d{2}\b/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
