import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKDROPS, backdropSvg, newBackdrop, sanitizeBackdrop } from '../src/backdrops';
import { createProject } from '../src/project';
import type { Theme } from '../src/types';

const theme = (): Theme => createProject({ occasionId: 'christmas' }).theme;
const box = { widthIn: 5, heightIn: 7, bleedIn: 0.125 };

test('every backdrop renders deterministic, print-safe vector SVG', () => {
  for (const d of BACKDROPS) {
    const spec = newBackdrop(d.kind, 1234);
    const a = backdropSvg(spec, theme(), box, 'x1');
    const b = backdropSvg(spec, theme(), box, 'x1');
    assert.equal(a, b, `${d.kind} must be deterministic`);
    assert.match(a, /^<svg [^>]*viewBox="0 0 525 725"/, d.kind);
    for (const banned of ['<filter', '<pattern', '<mask', '<image', '<script', 'foreignObject', 'href="http']) assert.ok(!a.includes(banned), `${d.kind} contains ${banned}`);
    assert.ok(a.length < 2_500_000, `${d.kind} is too heavy (${a.length} bytes)`);
    const other = backdropSvg(newBackdrop(d.kind, 99), theme(), box, 'x1');
    if (!['deco-border', 'scallop-frame'].includes(d.kind)) assert.notEqual(a, other, `${d.kind} should vary with the seed`);
  }
});

test('backdrop colours follow the theme (Color Harmony) and never inject markup', () => {
  const t = theme();
  t.colors.accent = '#123456';
  const svg = backdropSvg({ ...newBackdrop('stars', 7), colors: { primary: '@accent', secondary: '#ffffff' } }, t, box);
  assert.ok(svg.includes('#123456'));
  (t.colors as any).accent = '"/><script>alert(1)</script>';
  const evil = backdropSvg({ ...newBackdrop('stars', 7), colors: { primary: '@accent', secondary: '#ffffff' } }, t, box);
  assert.ok(!evil.includes('<script'));
  assert.ok(!evil.includes('alert'));
});

test('sanitizeBackdrop validates untrusted project data', () => {
  assert.equal(sanitizeBackdrop({ kind: 'nope' }), null);
  assert.equal(sanitizeBackdrop(null), null);
  const s = sanitizeBackdrop({ kind: 'snowfall', seed: -5, density: 9, scale: 0, opacity: 'x', colors: { primary: 'javascript:alert(1)', secondary: '@accent2' } })!;
  assert.equal(s.density, 1);
  assert.equal(s.scale, 0.5);
  assert.equal(s.seed, 0);
  assert.equal(s.colors.primary, '#ffffff');
  assert.equal(s.colors.secondary, '@accent2');
});

test('stock background resolution: DPI estimate, Guardian note and Soften', async () => {
  const { backgroundDpi, runGuardian } = await import('../src/guardian');
  const p = createProject({ occasionId: 'christmas' }); // 5x7 with 0.125" bleed
  const f = p.format;
  const bg = p.surfaces[0].background;
  // An 800x1200 image covering the 5.25x7.25" bleed box: cover scale is set by whichever side needs more.
  Object.assign(bg, { texture: 'stock:pixabay-1.jpg', textureMode: 'cover', textureWidth: 800, textureHeight: 1200 });
  const shown = Math.max(f.widthIn + 2 * f.bleedIn, ((f.heightIn + 2 * f.bleedIn) * 800) / 1200);
  assert.equal(Math.round(backgroundDpi(bg, f)!), Math.round(800 / shown)); // ≈152 DPI
  const base = { textBounds: {}, textOverflow: {}, textContrast: {}, failedRefs: [], availableFonts: [] };
  const low = runGuardian(p, base).issues.filter((i) => i.check === 'resolution' && !i.elementId);
  assert.equal(low.length, 1);
  assert.equal(low[0].severity, 'warn');
  assert.equal(low[0].fix, 'soften-background');
  bg.soften = true;
  const soft = runGuardian(p, base).issues.filter((i) => i.check === 'resolution' && !i.elementId);
  assert.equal(soft[0]?.severity, 'info');
  // A print-size image needs no note; SVG and unknown sizes are skipped.
  Object.assign(bg, { textureWidth: 6000, textureHeight: 8300, soften: false });
  assert.equal(runGuardian(p, base).issues.filter((i) => i.check === 'resolution' && !i.elementId).length, 0);
  assert.equal(backgroundDpi({ color: '#fff', texture: 'pack:x/a.svg', textureWidth: 10, textureHeight: 10 }, f), null);
  assert.equal(backgroundDpi({ color: '#fff', texture: 'pack:x/a.png' }, f), null);
});

test('project loading re-validates backdrops (shared copies are untrusted)', async () => {
  const { migrateProject } = await import('../src/project');
  const p = createProject({ occasionId: 'christmas' });
  (p.surfaces[0].background as any).backdrop = { kind: 'snowfall', seed: 1, density: 99, scale: -4, opacity: 2, colors: { primary: 'red" onload="x', secondary: '@accent' } };
  (p.surfaces[1].background as any).backdrop = { kind: 'not-a-kind' };
  const m = migrateProject(JSON.parse(JSON.stringify(p)));
  const bd = m.surfaces[0].background.backdrop!;
  assert.equal(bd.kind, 'snowfall');
  assert.ok(bd.density <= 1 && bd.scale >= 0.5 && bd.opacity <= 1);
  assert.ok(!String(bd.colors.primary).includes('"'));
  assert.equal(m.surfaces[1].background.backdrop, null);
});
