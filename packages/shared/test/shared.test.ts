import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILTIN_ORNAMENTS,
  buildRenderPages,
  pagePixels,
  shareDpi,
  BUILTIN_TEMPLATES,
  CARD_SIZES,
  OCCASIONS,
  applyTemplate,
  clearCustomTemplates,
  registerCustomTemplates,
  resolveColor,
  mixHex,
  autoEnhance,
  buildPipeline,
  changeFormat,
  computeImageStats,
  contrastRatio,
  createProject,
  defaultYearFor,
  duplicateProject,
  getOccasion,
  effectiveDpi,
  extractPalette,
  harmonyThemes,
  makeFormat,
  maskPath,
  pageBox,
  placeImage,
  resolveStylePack,
  resolveTokens,
  runGuardian,
  smartCrop,
  surfacesFor,
} from '../src/index';

test('every occasion creates a valid project in every size/orientation', () => {
  for (const occ of OCCASIONS) {
    for (const size of CARD_SIZES) {
      for (const orientation of size.orientations) {
        const p = createProject({ occasionId: occ.id, sizeId: size.id, orientation, greetingStyle: 'family-update' });
        assert.equal(p.surfaces.length, 2);
        for (const s of p.surfaces) {
          assert.ok(s.elements.length > 0, `${occ.id}/${size.id}/${s.id} has elements`);
          for (const e of s.elements) {
            for (const k of ['x', 'y', 'w', 'h'] as const) assert.ok(Number.isFinite(e[k]), `${occ.id} ${s.templateId} ${e.type}.${k}`);
            assert.ok(e.w > 0 && e.h > 0, `${s.templateId} ${e.type} positive size`);
          }
        }
      }
    }
  }
});

test('all templates build in portrait, landscape and square; text stays inside the trim', () => {
  const formats = [
    makeFormat({ sizeId: '5x7', orientation: 'portrait' }),
    makeFormat({ sizeId: '5x7', orientation: 'landscape' }),
    makeFormat({ sizeId: '5x5' }),
    makeFormat({ sizeId: '4x8', orientation: 'portrait' }),
    makeFormat({ sizeId: 'a2', orientation: 'landscape' }),
    makeFormat({ sizeId: 'dl', orientation: 'portrait' }),
    makeFormat({ sizeId: 'a4', orientation: 'landscape' }),
    makeFormat({ sizeId: 'saved:abc123', customW: 4.33, customH: 6.1 }),
  ];
  for (const fmt of formats) {
    for (const t of BUILTIN_TEMPLATES) {
      let p = createProject({ occasionId: 'christmas' });
      p = changeFormat(p, fmt);
      const s = applyTemplate(p, 'front', t.id);
      for (const e of s.elements) {
        if (e.type === 'text') {
          assert.ok(e.x >= -1e-6 && e.y >= -1e-6, `${t.id} ${e.role} inside trim (${fmt.widthIn}x${fmt.heightIn})`);
          assert.ok(e.x + e.w <= fmt.widthIn + 1e-6 && e.y + e.h <= fmt.heightIn + 1e-6, `${t.id} ${e.role} inside trim (${fmt.widthIn}x${fmt.heightIn}) → ${e.x + e.w}, ${e.y + e.h}`);
        }
      }
    }
  }
});

test('template switching preserves photos (with stash) and edited text', () => {
  let p = createProject({ occasionId: 'christmas' });
  p.photos = Array.from({ length: 6 }, (_, i) => ({ ref: `library:p${i}.jpg`, name: `p${i}`, width: 4000, height: 3000 }));
  let front = applyTemplate(p, 'front', 'collage-6-grid');
  front.elements = front.elements.map((e, i) =>
    e.type === 'photo' ? { ...e, fill: { ref: `library:p${e.slot}.jpg`, width: 4000, height: 3000, crop: { cx: 0.5, cy: 0.5, zoom: 1, mode: 'auto' as const }, polish: { auto: null, filterId: null, filterStrength: 1, user: {} as any } } } : e.type === 'text' && e.role === 'headline' ? { ...e, text: 'Custom Headline' } : e,
  );
  p = { ...p, surfaces: p.surfaces.map((s) => (s.id === 'front' ? front : s)) };
  const single = applyTemplate(p, 'front', 'full-bleed-classic');
  assert.equal(single.photoStash.length, 5);
  assert.equal((single.elements.find((e) => e.type === 'text' && e.role === 'headline') as any).text, 'Custom Headline');
  p = { ...p, surfaces: p.surfaces.map((s) => (s.id === 'front' ? single : s)) };
  const back = applyTemplate(p, 'front', 'collage-6-grid');
  assert.equal(back.elements.filter((e) => e.type === 'photo' && e.fill).length, 6);
});

test('smart crop keeps faces inside the frame and safe insets', () => {
  // Landscape photo, face on the far right, portrait frame.
  const r = smartCrop({ frameW: 5.25, frameH: 7.25, imgW: 6000, imgH: 4000, faces: [{ x: 0.78, y: 0.2, w: 0.08, h: 0.12 }], insets: { left: 0.375, top: 0.375, right: 0.375, bottom: 0.375 } });
  assert.ok(r.facesFit, 'face fits');
  const pl = placeImage(5.25, 7.25, 6000, 4000, r);
  const faceX = pl.left + 0.78 * pl.width;
  assert.ok(faceX > 0.375 && faceX + 0.08 * pl.width < 5.25 - 0.375);
  assert.ok(effectiveDpi(5.25, 7.25, 6000, 4000, r.zoom) > 250);
});

test('print geometry: 5x7 with bleed is 1575 x 2175 px at 300 DPI', () => {
  const f = makeFormat({ sizeId: '5x7' });
  const box = pageBox(f, { includeBleed: true, cropMarks: false });
  assert.equal(Math.round(box.widthIn * 300), 1575);
  assert.equal(Math.round(box.heightIn * 300), 2175);
  assert.deepEqual(surfacesFor({ fold: 'folded', includeBack: true }), ['front', 'inside-left', 'inside-right', 'back']);
});

test('adjustment pipeline: neutral is identity, auto-enhance brightens dark images', () => {
  const p = buildPipeline({});
  assert.ok(p.identity);
  const dark = new Uint8Array(64 * 64 * 3).map((_, i) => (i % 3 === 2 ? 75 : 50));
  const stats = computeImageStats(dark, 3);
  const a = autoEnhance(stats);
  assert.ok(a.brightness > 0.2, 'brightens');
  assert.ok(a.warmth > 0, 'warms a cool cast');
});

test('palette + harmony themes enforce readable contrast', () => {
  const px = new Uint8Array(100 * 100 * 3);
  for (let i = 0; i < px.length; i += 3) {
    const t = (i / 3) % 3;
    px.set(t === 0 ? [180, 30, 40] : t === 1 ? [20, 80, 50] : [240, 230, 210], i);
  }
  const pal = extractPalette(px, 3, 5);
  assert.ok(pal.length >= 3);
  for (const th of harmonyThemes(pal)) {
    assert.ok(contrastRatio(th.colors.text, th.colors.background) >= 4.5, `${th.name} text contrast`);
  }
});

test('ornaments and masks generate valid markup', () => {
  assert.ok(BUILTIN_ORNAMENTS.length >= 45);
  for (const o of BUILTIN_ORNAMENTS) {
    assert.ok(o.svg.startsWith('<svg') && o.svg.endsWith('</svg>'), o.id);
    assert.ok(!/NaN|undefined/.test(o.svg), `${o.id} has no NaN`);
    assert.ok(!/\sid=/.test(o.svg), `${o.id} uses no ids`);
  }
  for (const m of ['arch', 'heart', 'scallop', 'stamp'] as const) {
    const r = maskPath(m, 480, 672);
    assert.ok(r && !/NaN/.test(r.d), m);
  }
});

test('tokens and guardian placeholder detection', () => {
  const p = createProject({ occasionId: 'christmas', familyName: '' });
  assert.equal(resolveTokens('Love, {{family}} · {{year}}', p), `Love, The Smith Family · ${p.year}`);
  const report = runGuardian(p, { textBounds: {}, textOverflow: {}, textContrast: {}, failedRefs: [], availableFonts: [] });
  assert.equal(report.status, 'red');
  assert.ok(report.issues.some((i) => i.check === 'placeholder'));
  assert.ok(report.issues.some((i) => i.check === 'content'));
});

test('style pack validation', () => {
  const r = resolveStylePack({
    id: 'demo', name: 'Demo',
    palettes: [{ id: 'a', name: 'A', colors: { background: '#ffffff', text: '#111111', accent: '#aa0000' } }],
    ornaments: [{ id: 'x', name: 'X', file: 'ornaments/x.svg' }, { id: 'bad', name: 'Bad', file: '../../etc/passwd' }],
    foils: [{ id: 'g', name: 'G', stops: ['#aa8800', '#ffee99', '#886600'] }],
  });
  assert.equal(r.palettes.length, 1);
  assert.equal(r.ornaments.length, 1);
  assert.equal(r.foils.length, 1);
  assert.ok(r.errors.length >= 1);

  // Templates may only use pack artwork that the manifest declares.
  const t = resolveStylePack({
    id: 'demo',
    name: 'Demo',
    ornaments: [{ id: 'x', name: 'X', file: 'ornaments/x.svg' }],
    templates: [
      { id: 'ok', name: 'OK', layouts: { any: [{ type: 'ornament', asset: 'pack:demo/ornaments/x.svg', rect: [0, 0, 1, 0.1] }] } },
      { id: 'bad', name: 'Bad', layouts: { any: [{ type: 'ornament', asset: 'pack:demo/ornaments/y.svg', rect: [0, 0, 1, 0.1] }] } },
      'templates/missing.json',
    ],
  });
  assert.equal(t.templates.length, 2);
  assert.ok(t.errors.some((e) => e.includes('"bad"') && e.includes('ornaments/y.svg')));
  assert.ok(t.errors.some((e) => e.includes('templates/missing.json')));
});

test('folded cards never repeat the same message on both inside panels', () => {
  for (const occ of OCCASIONS) {
    const p = createProject({ occasionId: occ.id, familyName: 'Rivera', fold: 'folded' });
    const msg = (id: string) =>
      p.surfaces.find((s) => s.id === id)?.elements.find((e) => e.type === 'text' && e.role === 'message') as { text: string } | undefined;
    const left = msg('inside-left');
    const right = msg('inside-right');
    if (left && right && left.text.trim()) assert.notEqual(left.text, right.text, `${occ.id}: inside panels repeat the same message`);
  }
});

test('guardian flags style-pack artwork that is no longer installed', () => {
  const p = createProject({ occasionId: 'christmas', familyName: 'Rivera' });
  const front = p.surfaces.find((s) => s.id === 'front')!;
  front.elements.push({ id: 'orn1', type: 'ornament', asset: 'pack:gone/ornaments/star.svg', color: '@accent', x: 1, y: 1, w: 1, h: 1, rotation: 0, opacity: 1 });
  front.background.texture = 'pack:gone/textures/linen.jpg';
  const base = { textBounds: {}, textOverflow: {}, textContrast: {}, failedRefs: [], availableFonts: [] };
  const missing = runGuardian(p, { ...base, availableAssets: [] }).issues.filter((i) => i.check === 'content' && /Missing/.test(i.title));
  assert.equal(missing.length, 2);
  assert.ok(missing.some((i) => i.elementId === 'orn1'));
  // Installed → no issue; list not loaded yet (undefined) → check skipped.
  const installed = runGuardian(p, { ...base, availableAssets: ['pack:gone/ornaments/star.svg', 'pack:gone/textures/linen.jpg'] });
  assert.ok(!installed.issues.some((i) => /Missing/.test(i.title)));
  assert.ok(!runGuardian(p, base).issues.some((i) => /Missing/.test(i.title)));
});

test('render pages: panels, spreads, crop marks and exact 300 DPI pixels', () => {
  const flat = makeFormat({ sizeId: '5x7', vendorId: 'generic' });
  const pages = buildRenderPages(flat, { surfaces: ['front', 'back'], includeBleed: true, cropMarks: false, layout: 'panels' });
  assert.equal(pages.length, 2);
  assert.deepEqual(pagePixels(pages[0], 300), { w: 1575, h: 2175 });
  assert.deepEqual(pages[0].trim, { x: 0.125, y: 0.125, w: 5, h: 7 });
  assert.deepEqual(pages[0].bleed, { x: 0, y: 0, w: 5.25, h: 7.25 });

  const noBleed = buildRenderPages(flat, { surfaces: ['front'], includeBleed: false, cropMarks: false, layout: 'panels' });
  assert.deepEqual(pagePixels(noBleed[0], 300), { w: 1500, h: 2100 });

  const marked = buildRenderPages(flat, { surfaces: ['front'], includeBleed: true, cropMarks: true, layout: 'panels' });
  assert.equal(marked[0].marks.length, 8);
  for (const m of marked[0].marks) {
    // Marks must sit outside the bleed box and inside the page.
    const inBleedX = Math.min(m.x1, m.x2) > marked[0].bleed.x + 1e-6 && Math.max(m.x1, m.x2) < marked[0].bleed.x + marked[0].bleed.w - 1e-6;
    const inBleedY = Math.min(m.y1, m.y2) > marked[0].bleed.y + 1e-6 && Math.max(m.y1, m.y2) < marked[0].bleed.y + marked[0].bleed.h - 1e-6;
    assert.ok(!(inBleedX && inBleedY), 'crop mark intrudes into bleed');
    assert.ok(Math.max(m.x1, m.x2, m.y1, m.y2) <= Math.max(marked[0].widthIn, marked[0].heightIn) + 1e-9);
    // Full-length marks that stop short of the paper edge (never clipped by the page).
    assert.ok(Math.abs(Math.hypot(m.x2 - m.x1, m.y2 - m.y1) - 0.2) < 1e-9, 'crop mark was clipped');
    for (const x of [m.x1, m.x2]) assert.ok(x >= 0.05 && x <= marked[0].widthIn - 0.05, 'crop mark touches the paper edge');
    for (const y of [m.y1, m.y2]) assert.ok(y >= 0.05 && y <= marked[0].heightIn - 0.05, 'crop mark touches the paper edge');
  }
  assert.deepEqual(pagePixels(marked[0], 300), { w: 1770, h: 2370 });

  const folded = makeFormat({ sizeId: '5x7', fold: 'folded' });
  const spreads = buildRenderPages(folded, { surfaces: ['front', 'inside-left', 'inside-right', 'back'], includeBleed: true, cropMarks: false, layout: 'spreads' });
  assert.equal(spreads.length, 2);
  assert.deepEqual(pagePixels(spreads[0], 300), { w: 3075, h: 2175 });
  assert.deepEqual(spreads[0].panels.map((p) => p.surface), ['back', 'front']);
  // No bleed at the fold: windows meet exactly at the fold line.
  assert.ok(Math.abs(spreads[0].panels[0].window.x + spreads[0].panels[0].window.w - spreads[0].panels[1].window.x) < 1e-9);

  const tent = makeFormat({ sizeId: '5x7', orientation: 'landscape', fold: 'folded' });
  const tentPages = buildRenderPages(tent, { surfaces: ['front', 'back'], includeBleed: true, cropMarks: true, layout: 'spreads' });
  assert.equal(tentPages.length, 1);
  assert.equal(tentPages[0].panels[0].rotate, 180);
  assert.deepEqual(pagePixels(tentPages[0], 300).w, Math.round((7 + 2 * tentPages[0].trim.x) * 300));
  assert.ok(tentPages[0].marks.some((m) => m.kind === 'fold'));
  assert.equal(Math.round(shareDpi(flat) * 5), 1080);
});

test('the {{year}} default follows the occasion’s next date, and copies of old cards move to it', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`);
  const year = (id: string, iso: string) => defaultYearFor(getOccasion(id), at(iso));
  assert.equal(year('christmas', '2026-11-23'), 2026);
  assert.equal(year('new-year', '2026-08-31'), 2026);
  assert.equal(year('new-year', '2026-09-01'), 2027);
  assert.equal(year('valentines', '2026-02-10'), 2026);
  assert.equal(year('valentines', '2026-11-23'), 2027);
  assert.equal(year('halloween', '2026-10-20'), 2026);
  assert.equal(year('halloween', '2026-11-11'), 2027);
  assert.equal(year('wedding', '2026-12-31'), 2026);

  const last = createProject({ occasionId: 'christmas', now: at('2025-11-20') });
  assert.equal(last.year, 2025);
  assert.equal(resolveTokens('Christmas {{year}}', last), 'Christmas 2025');
  const again = duplicateProject(last, undefined, at('2026-11-23'));
  assert.equal(again.year, 2026);
  assert.equal(resolveTokens('Christmas {{year}}', again), 'Christmas 2026');
  // A card already set to a later year (made early for next season) keeps it.
  const ahead = duplicateProject({ ...last, year: 2027 }, undefined, at('2026-11-23'));
  assert.equal(ahead.year, 2027);
});

test('accent text that would not read on its backing gets a readable theme colour', () => {
  registerCustomTemplates(
    [{
      id: 'ink',
      layouts: {
        any: [
          { type: 'text', role: 'subhead', rect: [0.1, 0.1, 0.8, 0.1] },
          { type: 'shape', shape: 'rect', fill: '@text', rect: [0.1, 0.35, 0.8, 0.2] },
          { type: 'text', role: 'year', rect: [0.15, 0.4, 0.7, 0.1] },
          { type: 'photo', slot: 0, rect: [0, 0.65, 1, 0.35] },
          { type: 'text', role: 'monogram', rect: [0.05, 0.75, 0.2, 0.15] },
          { type: 'shape', shape: 'rect', fill: '@surface', opacity: 0.93, rect: [0.5, 0.7, 0.45, 0.25] },
          { type: 'text', role: 'message', color: '@accent', rect: [0.55, 0.75, 0.35, 0.15] },
        ],
      },
    }] as any,
    'test',
  );
  try {
    const need = (e: any) => (e.fontSize >= 18 ? 3 : 4.5);
    const p = createProject({ occasionId: 'easter' });
    const c = p.theme.colors;
    assert.ok(contrastRatio(c.accent, c.background) < 4.5, 'Easter pairs a light accent with light paper');
    const s = applyTemplate(p, 'front', 'test:ink');
    const text = (role: string) => s.elements.find((e) => e.type === 'text' && e.role === role) as any;
    const sub = text('subhead');
    assert.notEqual(sub.color, '@accent', 'subhead on paper moves off the accent');
    assert.ok(contrastRatio(resolveColor(sub.color, p.theme), c.background) >= need(sub));
    const year = text('year');
    assert.ok(contrastRatio(resolveColor(year.color, p.theme), c.text) >= need(year), 'year on a dark panel reads');
    assert.equal(text('monogram').color, '@accent', 'text straight on a photo is left to the photo checks');
    // A 93% plaque over a photo: must read whether the photo beneath is black or white.
    const msg = text('message');
    for (const under of ['#000000', '#ffffff']) {
      const plaque = mixHex(under, c.surface, 0.93);
      assert.ok(contrastRatio(resolveColor(msg.color, p.theme), plaque) >= need(msg), `message ${msg.color} on the plaque over ${under}`);
    }

    // Every occasion's own palette: accent text on plain paper always clears the bar.
    for (const occ of OCCASIONS) {
      const q = createProject({ occasionId: occ.id });
      const sub2 = applyTemplate(q, 'front', 'test:ink').elements.find((e) => e.type === 'text' && e.role === 'subhead') as any;
      const ratio = contrastRatio(resolveColor(sub2.color, q.theme), q.theme.colors.background);
      assert.ok(ratio >= need(sub2), `${occ.id}: subhead ${sub2.color} reads at ${ratio.toFixed(1)}:1`);
      if (contrastRatio(q.theme.colors.accent, q.theme.colors.background) >= need(sub2)) assert.equal(sub2.color, '@accent', `${occ.id} keeps a readable accent`);
    }
  } finally {
    clearCustomTemplates();
  }
});
