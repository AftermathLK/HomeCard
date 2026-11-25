import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CARD_SIZES,
  defaultFavoriteSizes,
  findCardSize,
  formatDims,
  formatLength,
  fromUnit,
  makeFormat,
  MAX_SAVED_SIZES,
  sanitizeUserPrefs,
  toUnit,
} from '../src/index';

test('lengths read in inches or millimetres', () => {
  assert.equal(formatDims(5, 7, 'in'), '5 × 7"');
  assert.equal(formatDims(5, 7, 'mm'), '127 × 177.8 mm');
  assert.equal(formatLength(0.125, 'in'), '0.125"');
  assert.equal(formatLength(0.125, 'mm'), '3.2 mm');
  assert.equal(formatLength(0.105, 'in'), '0.105"');
  assert.ok(Math.abs(fromUnit(toUnit(4.25, 'mm'), 'mm') - 4.25) < 1e-9);
  const a6 = makeFormat({ sizeId: 'a6' });
  assert.equal(formatDims(a6.widthIn, a6.heightIn, 'mm'), '105 × 148 mm', 'ISO sizes are exact in mm');
  assert.equal(formatDims(a6.widthIn, a6.heightIn, 'in'), '4.13 × 5.83"');
});

test('ISO sizes turn landscape and fold like the inch sizes', () => {
  const a5 = makeFormat({ sizeId: 'a5', orientation: 'landscape', fold: 'folded' });
  assert.equal(a5.sizeId, 'a5');
  assert.ok(a5.widthIn > a5.heightIn);
  assert.equal(formatDims(a5.widthIn, a5.heightIn, 'mm'), '210 × 148 mm');
  const sq = makeFormat({ sizeId: 'sq150', orientation: 'landscape' });
  assert.equal(sq.widthIn, sq.heightIn);
  for (const unit of ['in', 'mm'] as const) {
    for (const id of defaultFavoriteSizes(unit)) assert.ok(findCardSize(id), `${id} exists`);
    assert.equal(CARD_SIZES.filter((s) => s.popularFor === unit).length, 1);
  }
});

test('a card at a saved size keeps the saved id and its own measurements', () => {
  const f = makeFormat({ sizeId: 'saved:k3x9', customW: 4.331, customH: 6.102, orientation: 'landscape' });
  assert.equal(f.sizeId, 'saved:k3x9');
  assert.deepEqual([f.widthIn, f.heightIn], [4.331, 6.102], 'width and height are taken as given');
  assert.equal(makeFormat({ sizeId: 'saved:../../x', customW: 5, customH: 5 }).sizeId, 'custom', 'odd ids fall back to custom');
  assert.equal(makeFormat({ sizeId: 'custom', customW: 40, customH: 0.5 }).widthIn, 14);
  assert.equal(makeFormat({ sizeId: 'custom', customW: 40, customH: 0.5 }).heightIn, 2);
  const saved = [{ id: 'k3x9', name: 'Craft A6', w: 4.331, h: 6.102 }];
  assert.equal(findCardSize('saved:k3x9', saved)?.name, 'Craft A6');
  assert.equal(findCardSize('saved:gone', saved), undefined);
});

test('account preferences keep only valid units and sizes', () => {
  assert.deepEqual(sanitizeUserPrefs(null), {});
  assert.deepEqual(sanitizeUserPrefs({ units: 'cubits', isAdmin: true, defaultVendorId: 'nope' }), {}, 'nothing valid → nothing to merge');
  const p = sanitizeUserPrefs({
    defaultVendorId: 'mpix',
    units: 'mm',
    favoriteSizes: ['a6', 'a6', 'saved:k3x9', 'custom', 'saved:../x', 7, 'made-up'],
    savedSizes: [
      { id: 'k3x9', name: '  Craft A6 \u0007 ', w: 6.102, h: 4.331 },
      { id: 'k3x9', name: 'Duplicate', w: 5, h: 5 },
      { id: 'BAD ID', name: 'x', w: 5, h: 5 },
      { id: 'big', name: 'Huge', w: 99, h: 1 },
      { id: 'noname', name: '   ', w: 5, h: 7 },
      { id: 'nan', name: 'NaN', w: Number.NaN, h: 7 },
    ],
  });
  assert.equal(p.defaultVendorId, 'mpix');
  assert.equal(p.units, 'mm');
  assert.deepEqual(p.favoriteSizes, ['a6', 'saved:k3x9']);
  assert.deepEqual(p.savedSizes, [
    { id: 'k3x9', name: 'Craft A6', w: 4.331, h: 6.102 },
    { id: 'big', name: 'Huge', w: 2, h: 14 },
  ], 'stored portrait, clamped to 2–14 inches, names cleaned');
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, name: `Size ${i}`, w: 5, h: 7 }));
  assert.equal(sanitizeUserPrefs({ savedSizes: many }).savedSizes!.length, MAX_SAVED_SIZES);
  assert.equal(sanitizeUserPrefs({ name: 'x'.repeat(100), savedSizes: [{ id: 'a', name: 'y'.repeat(100), w: 5, h: 7 }] }).savedSizes![0].name.length, 40);
});
