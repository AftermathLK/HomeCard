import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  BUILTIN_ORNAMENTS,
  BUNDLED_FONTS,
  clearCustomTemplates,
  getTemplate,
  OCCASIONS,
  parsePackAssetRef,
  registerCustomTemplates,
  resolveStylePack,
  templateContext,
  type ResolvedStylePack,
} from '@homecard/shared';
import { sanitizeSvg } from '../src/styles/sanitize';

/** The starter kit that is copied into /data/styles on first start. */
const STYLES = path.resolve(import.meta.dirname, '../../../data/styles');
// The largest preset card (6×8″) plus bleed, and the Print Guardian's "yellow" threshold.
const MAX_CARD_IN = { w: 6.25, h: 8.25 };
const MIN_DPI = 250;

function loadStarterPacks() {
  const packs: Array<{ dir: string; raw: any; pack: ResolvedStylePack }> = [];
  for (const name of fs.readdirSync(STYLES).sort()) {
    const dir = path.join(STYLES, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    raw.templates = (raw.templates ?? []).map((t: unknown) => (typeof t === 'string' ? JSON.parse(fs.readFileSync(path.join(dir, t), 'utf8')) : t));
    assert.equal(raw.id, name, `${name}: pack id must match its folder`);
    packs.push({ dir, raw, pack: resolveStylePack(raw, 'starter') });
  }
  return packs;
}

test('every bundled style pack loads without errors and only uses known occasions and fonts', () => {
  const packs = loadStarterPacks();
  assert.ok(packs.length >= 16, `found ${packs.length} starter packs`);
  const occasions = new Set(OCCASIONS.map((o) => o.id));
  const fonts = new Map(BUNDLED_FONTS.map((f) => [f.family, f]));
  for (const { pack } of packs) {
    assert.deepEqual(pack.errors, [], `${pack.id}: ${pack.errors.join('; ')}`);
    assert.equal(pack.license, 'CC0-1.0', `${pack.id}: licence`);
    for (const o of pack.occasions) assert.ok(occasions.has(o), `${pack.id}: unknown occasion "${o}"`);
    for (const fp of pack.fontPairings) {
      for (const spec of [fp.display, fp.body, fp.accent]) {
        const f = fonts.get(spec.family);
        assert.ok(f, `${fp.id}: font "${spec.family}" is not bundled`);
        assert.ok(f.weights.includes(spec.weight ?? 400), `${fp.id}: ${spec.family} has no weight ${spec.weight}`);
        if (spec.style === 'italic') assert.ok(f.italics, `${fp.id}: ${spec.family} has no italic`);
      }
    }
  }
});

test('bundled style-pack artwork is safe, present and sharp enough to print', async () => {
  const packs = loadStarterPacks();
  for (const { dir, pack } of packs) {
    for (const a of [...pack.ornaments, ...pack.stickers, ...pack.backgrounds]) {
      const abs = path.join(dir, a.file);
      assert.ok(fs.existsSync(abs), `${pack.id}: missing ${a.file}`);
      if (a.file.endsWith('.svg')) {
        const src = fs.readFileSync(abs, 'utf8');
        assert.match(src, /viewBox=/, `${pack.id}/${a.file}: needs a viewBox`);
        assert.doesNotMatch(src, /<script|\son\w+\s*=|https?:\/\/(?!www\.w3\.org\/)/i, `${pack.id}/${a.file}: scripts or external links`);
        assert.doesNotThrow(() => sanitizeSvg(src, a.asset));
      }
    }
    for (const b of pack.backgrounds) {
      if (b.file.endsWith('.svg')) continue;
      const { width = 0, height = 0 } = await sharp(path.join(dir, b.file)).metadata();
      const dpi = b.mode === 'cover' ? Math.min(width / MAX_CARD_IN.w, height / MAX_CARD_IN.h, width / MAX_CARD_IN.h, height / MAX_CARD_IN.w) : Math.min(width, height) / b.tileSizeIn;
      assert.ok(dpi >= MIN_DPI, `${pack.id}/${b.file}: ${width}×${height} prints at ${Math.round(dpi)} DPI`);
    }
  }
});

test('bundled templates build, start their photo slots at 0 and only use artwork that exists', () => {
  const packs = loadStarterPacks();
  const declared = new Set(packs.flatMap(({ pack }) => pack.ornaments.map((o) => o.asset)));
  const builtin = new Set(BUILTIN_ORNAMENTS.map((o) => o.id));
  clearCustomTemplates();
  try {
    for (const { pack } of packs) {
      registerCustomTemplates(pack.templates, pack.id);
      for (const t of pack.templates) {
        const def = getTemplate(`${pack.id}:${t.id}`);
        assert.equal(def.id, `${pack.id}:${t.id}`, `${pack.id}: template ${t.id} did not register`);
        for (const [key, els] of Object.entries(t.layouts)) {
          const slots = [...new Set((els ?? []).filter((e) => e.type === 'photo').map((e: any) => e.slot as number))].sort((a, b) => a - b);
          assert.deepEqual(slots, slots.map((_, i) => i), `${pack.id}:${t.id}/${key}: photo slots ${slots}`);
          for (const e of els ?? []) {
            if (e.type !== 'ornament') continue;
            const ref = parsePackAssetRef(e.asset);
            if (ref) assert.ok(declared.has(e.asset), `${pack.id}:${t.id}: ${e.asset} is not a declared ornament of any starter pack`);
            else assert.ok(e.asset === '@icon' || builtin.has(e.asset), `${pack.id}:${t.id}: unknown ornament ${e.asset}`);
          }
        }
        for (const [w, h] of [[5, 7], [7, 5], [5, 5]]) {
          const els = def.build(templateContext({ widthIn: w, heightIn: h, bleedIn: 0.125, safeIn: 0.25 } as any, def.defaults));
          assert.ok(els.length > 0, `${def.id} builds nothing at ${w}×${h}`);
          // sizeRel is a share of the short side (0.1 ≈ 36 pt on a 5″ card): set far above its box is a typo.
          for (const e of els) {
            if (e.type === 'text') assert.ok(e.fontSize <= 2 * e.h * 72, `${def.id} at ${w}×${h}: ${e.role} is ${e.fontSize} pt in a ${Math.round(e.h * 72)} pt box`);
          }
        }
      }
    }
  } finally {
    clearCustomTemplates();
  }
});
