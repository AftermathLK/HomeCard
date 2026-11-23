// Layout families for 0–6 photos. Each family is a parametric blueprint; every parameter set is
// one candidate skeleton. A candidate builds its elements per orientation from the context `c`
// (inches) and a "dress" `d` (ornament assets, stack preferences, foil) supplied by the pack.
import {
  R, card, inset, insetSides, split, grid, partition, fitSquare, fitAspect, sq, box,
  photo, photos, text, orn, shape, scrim, rule, stack, zone, fitStack, rolesOf, safe, ctxFor,
} from './engine.mjs';

/* ------------------------------ zone collector ------------------------------ */
// Text zones a build used: part of a layout's identity (same photos + same text area = same layout).
let ZONES = [];
export function beginBuild() { ZONES = []; }
export function builtZones() { return ZONES; }
const Z = (c, r, mode, key, o) => { ZONES.push({ r, mode, align: o?.align ?? 'center' }); return zone(c, r, mode, key, o); };

/* ------------------------------ helpers ------------------------------ */

const rot = (list, k) => list.map((_, i) => list[(i + k) % list.length]);
/** Stack preferences for a zone kind from the dress, rotated by the candidate variant. */
const prefs = (d, kind, k = 0) => rot(d.stacks[kind] ?? d.stacks.band, k);
const so = (d, extra = {}) => ({ div: d.div, divAspect: d.divAspect, icon: d.icon, foil: d.foil, themed: !d.generic, bigYear: d.bigYear, ...extra });

/** Split the card into a photo area and a text band. side is given for a portrait card; on a
 * landscape card top/bottom bands move to the left/right (unless keep), on a square they stay. */
function cardBand(c, side, frac, keep = false) {
  let s = side;
  if (c.L && !keep) s = { bottom: 'right', top: 'left', left: 'left', right: 'right' }[side];
  const f = c.L && !keep && (side === 'top' || side === 'bottom') ? Math.min(0.42, frac * 1.25) : c.S ? Math.min(0.42, frac * 1.12) : frac;
  const A = card(c);
  const axis = s === 'top' || s === 'bottom' ? 'y' : 'x';
  const first = s === 'top' || s === 'left';
  const [a, b] = split(A, axis, first ? [f, 1 - f] : [1 - f, f]);
  return first ? { main: b, band: a, s } : { main: a, band: b, s };
}

/** Swap a portrait-designed partition when the area's orientation differs from the design's. */
function needSwap(c, area, designAspect) {
  const a = area.w / area.h;
  if (Math.abs(a - 1) < 0.12 || Math.abs(designAspect - 1) < 0.12) return c.L;
  return (a > 1) !== (designAspect > 1);
}

const maskOpts = (mask, radius) => (mask === 'rounded' ? { mask, radius: radius ?? 0.14 } : mask && mask !== 'rect' ? { mask } : {});
/** Round masks need square boxes; others use the whole cell. */
const maskRect = (r, mask) => (mask === 'circle' || mask === 'heart' ? fitSquare(inset(r, 0.02)) : r);

/** Decoration hooks */
function corners(c, r, d, s) {
  if (!d.corner) return [];
  return [
    orn(d.corner, R(r.x, r.y, s, s)),
    orn(d.corner, R(r.x + r.w - s, r.y, s, s), { flipX: true }),
    orn(d.corner, R(r.x + r.w - s, r.y + r.h - s, s, s), { rotation: 180 }),
    orn(d.corner, R(r.x, r.y + r.h - s, s, s), { rotation: 180, flipX: true }),
  ];
}
const frame = (d, r, which = 'frame') => (d[which] ? [orn(d[which], r)] : []);

/* ============================================================================================
 * Multi-photo mosaic: a guillotine partition of the photo area plus a text treatment.
 *   tree: portrait-designed partition ('p' photo leaves, 't' text tile)
 *   m: outer margin (in), g: gutter (in), mask/radius/frame: photo styling
 *   text: { mode: band|tile|overlay|badge|none, side, frac, backing, kind }
 * ========================================================================================== */
function mosaic(c, d, p) {
  const out = [];
  let area = card(c);
  let band = null;
  if (p.text.mode === 'band') {
    const b = cardBand(c, p.text.side, p.text.frac, p.text.keep);
    area = b.main;
    band = b.band;
  }
  const m = p.m ?? 0;
  const photoArea = m > 0 ? inset(area, m) : area;
  // Design aspect: the same area on the portrait reference card.
  const pc = ctxFor('portrait');
  let pArea = card(pc);
  if (p.text.mode === 'band') pArea = cardBand(pc, p.text.side, p.text.frac, p.text.keep).main;
  if (m > 0) pArea = inset(pArea, m);
  const leaves = partition(photoArea, p.tree, p.g ?? 0, p.noSwap ? false : needSwap(c, photoArea, pArea.w / pArea.h));
  const pr = leaves.filter((l) => l.kind === 'p').map((l) => maskRect(l.rect, p.mask));
  out.push(...photos(pr, { ...maskOpts(p.mask, p.radius), ...(p.frameStyle ? { frameStyle: p.frameStyle, shadow: true } : {}), ...(p.shadow ? { shadow: true } : {}) }));
  const k = p.k ?? 0;
  const tile = leaves.find((l) => l.kind === 't');
  if (tile) {
    const tr = tile.rect;
    const backing = p.text.backing ?? 'surface';
    out.push(...Z(c, tr, backing, fitStack(inset(tr, 0.15), prefs(d, 'tile', k)), so(d, { align: p.text.align })));
  }
  if (band) {
    const backing = p.text.backing ?? 'plain';
    out.push(...Z(c, band, backing, fitStack(inset(band, 0.2), prefs(d, 'band', k)), so(d, { align: p.text.align })));
    if (p.deco === 'rule') out.push(...bandRule(c, band, area, d));
  }
  if (p.text.mode === 'overlay') {
    // Scrim along one edge of the whole photo area; text in its strong part.
    const where = p.text.side ?? 'bottom';
    const f = p.text.frac ?? 0.34;
    const A = photoArea;
    const sr = where === 'bottom' ? R(A.x, A.y + A.h * (1 - f), A.w, A.h * f) : where === 'top' ? R(A.x, A.y, A.w, A.h * f) : where === 'left' ? R(A.x, A.y, A.w * f, A.h) : R(A.x + A.w * (1 - f), A.y, A.w * f, A.h);
    const tr = where === 'bottom' ? insetSides(sr, 0, sr.h * 0.25, 0, 0) : where === 'top' ? insetSides(sr, 0, 0, 0, sr.h * 0.25) : where === 'left' ? insetSides(sr, 0, 0, sr.w * 0.2, 0) : insetSides(sr, sr.w * 0.2, 0, 0, 0);
    out.push(...Z(c, tr, `scrim-${where}`, fitStack(inset(tr, 0.2), prefs(d, 'overlay', k)), so(d, { scrimRect: sr, align: p.text.align })));
  }
  if (p.text.mode === 'badge') {
    const A = photoArea;
    const shapeKind = p.text.badge ?? 'plaque';
    const bw = shapeKind === 'ellipse' ? Math.min(A.w, A.h) * 0.52 : Math.min(A.w * 0.62, 3.4);
    const bh = shapeKind === 'ellipse' ? bw : Math.min(A.h * 0.3, bw * 0.55);
    const br = box(A.x + A.w / 2, A.y + A.h * (p.text.at ?? 0.5), bw, bh);
    out.push(...Z(c, br, shapeKind, fitStack(inset(br, 0.15), prefs(d, 'badge', k)), so(d, { radius: p.text.radius ?? 0.08 })));
  }
  if (p.deco === 'frame' && m >= 0.22) out.push(...frame(d, inset(area, m * 0.45)));
  if (p.deco === 'corners' && m >= 0.3) out.push(...corners(c, inset(area, m * 0.18), d, m * 0.78));
  return out;
}

/** A thin accent rule where a text band meets the photos. */
function bandRule(c, band, area, d) {
  const vertical = Math.abs(band.h - area.h) < 0.01;
  if (vertical) {
    const x = band.x < area.x + 0.01 ? band.x + band.w - 0.001 : band.x;
    return [rule(R(x - 0.005, band.y + band.h * 0.2, 0.01, band.h * 0.6), { shape: 'rect' })];
  }
  const y = band.y < area.y + 0.01 ? band.y + band.h : band.y;
  return [rule(R(band.x + band.w * 0.3, y - 0.005, band.w * 0.4, 0.01), { shape: 'rect' })];
}

/* ============================================================================================
 * Candidate registry
 * ========================================================================================== */

const FAMILIES = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
/**
 * fam(n, key, cat, title, variants, build, opts)
 *   variants: array of param objects (each gets .k = index for stack rotation)
 *   label(p): short descriptor for names/ids
 */
function fam(n, key, cat, title, variants, build, label, opts = {}) {
  FAMILIES[n].push({ n, key, cat, title, variants: variants.map((p, i) => ({ ...p, k: p.k ?? i })), build, label, kinds: opts.kinds, affinity: opts.affinity ?? [] });
}
const cross = (...lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((b) => ({ ...a, ...b }))), [{}]);

/* ------------------------------------------------------------------------------------------ */
/* 0 PHOTOS                                                                                     */
/* ------------------------------------------------------------------------------------------ */

// Oversized editorial display type.
fam(0, 'display', 'typography', 'Display Type',
  cross([{ align: 'left' }, { align: 'center' }, { align: 'right' }], [{ pos: 'top' }, { pos: 'middle' }, { pos: 'bottom' }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), c.u * 0.1));
    const H = A.h * (c.L ? 0.62 : 0.5);
    const y = p.pos === 'top' ? A.y : p.pos === 'bottom' ? A.y + A.h - H : A.y + (A.h - H) / 2;
    const r = R(A.x, y, A.w, H);
    const out = [...Z(c, r, 'plain', 'editorial', so(d, { align: p.align }))];
    const ry = p.pos === 'bottom' ? A.y + A.h * 0.08 : A.y + A.h * 0.92;
    out.push(rule(R(p.align === 'right' ? A.x + A.w * 0.55 : p.align === 'left' ? A.x : A.x + A.w * 0.3, ry, A.w * (p.align === 'center' ? 0.4 : 0.45), 0.02)));
    return out;
  },
  (p) => `${p.align}-${p.pos}`, { kinds: ['front', 'back', 'inside'] });

// Arched typographic crest: motif crest over the greeting.
fam(0, 'crest', 'typography', 'Crest',
  cross([{ size: 0.34 }, { size: 0.24 }], [{ y: 0.12 }, { y: 0.2 }], [{ st: 'classic' }, { st: 'formal' }, { st: 'names-first' }]),
  (c, d, p) => {
    const s = c.u * p.size;
    const top = c.H * p.y;
    const crestR = sq(c.W / 2, top + s / 2, s);
    const rest = safe(c, R(c.W * 0.1, top + s + 0.12, c.W * 0.8, c.H * 0.86 - top - s - 0.12));
    return [orn(d.icon, crestR), ...Z(c, rest, 'plain', fitStack(rest, [p.st, 'classic', 'minimal']), so(d))];
  },
  (p) => `${p.st}-${Math.round(p.size * 100)}-${Math.round(p.y * 100)}`, { kinds: ['front', 'back', 'inside'] });

// Monogram seal: a circular seal with the initial, names and year around it.
fam(0, 'seal', 'cutout', 'Monogram Seal',
  cross([{ fill: '@surface' }, { fill: '@text' }, { fill: 'ring' }], [{ at: 0.38 }, { at: 0.5 }], [{ under: 'classic' }, { under: 'minimal' }]),
  (c, d, p) => {
    const s = c.u * (c.L ? 0.5 : 0.52);
    const cy = c.H * p.at;
    const sr = sq(c.W / 2, cy, s);
    const out = [];
    if (p.fill === 'ring') out.push(shape(sr, { shape: 'ellipse', fill: '@surface' }), orn(d.frameRound ?? 'frame-double', inset(sr, s * 0.04)));
    else out.push(shape(sr, { shape: 'ellipse', fill: p.fill }));
    const ink = p.fill === '@text' ? '@background' : undefined;
    out.push(text('monogram', inset(sr, s * 0.2), { size: Math.min(0.3, (s * 0.5) / c.u), color: ink ?? '@accent', ...(d.foil && !ink ? { fill: 'foil' } : {}) }));
    const below = safe(c, R(c.W * 0.1, sr.y + s + 0.15, c.W * 0.8, c.H * 0.9 - (sr.y + s + 0.15)));
    const above = safe(c, R(c.W * 0.1, c.H * 0.08, c.W * 0.8, sr.y - 0.15 - c.H * 0.08));
    if (below.h > 0.7) out.push(...Z(c, below, 'plain', fitStack(below, [p.under, 'caption', 'headline']), so(d)));
    if (above.h > 0.45) out.push(...Z(c, above, 'plain', 'kicker', so(d)));
    return out;
  },
  (p) => `${p.fill === '@text' ? 'dark' : p.fill === 'ring' ? 'ring' : 'soft'}-${p.under}-${Math.round(p.at * 100)}`, { kinds: ['front', 'back', 'inside'] });

// Framed letterpress stationery.
fam(0, 'letterpress', 'framed', 'Letterpress',
  cross([{ m: 0.22 }, { m: 0.4 }], [{ place: 'center' }, { place: 'upper' }, { place: 'lower' }, { place: 'left' }]),
  (c, d, p) => {
    const F = inset(card(c), p.m * c.u / 5 + 0.08);
    const inner = safe(c, inset(F, c.u * 0.14));
    const out = [...frame(d, F, p.k % 2 ? 'frame2' : 'frame')];
    if (p.place === 'center') {
      out.push(...Z(c, inner, 'plain', fitStack(inner, ['formal', 'crest', 'classic']), so(d)));
    } else if (p.place === 'upper') {
      const [top, bottom] = split(inner, 'y', [0.6, 0.4], 0.2);
      const key = fitStack(top, ['crest', 'formal', 'classic']);
      out.push(...Z(c, top, 'plain', key, so(d)), ...Z(c, bottom, 'plain', fitStack(bottom, ['note', 'message-only', 'signoff'], rolesOf(key)), so(d)));
    } else if (p.place === 'lower') {
      const [top, bottom] = split(inner, 'y', [0.42, 0.58], 0.2);
      const s = Math.min(top.w, top.h) * 0.7;
      out.push(orn(d.icon, box(top.x + top.w / 2, top.y + top.h * 0.55, s, s)));
      out.push(...Z(c, bottom, 'plain', fitStack(bottom, ['formal', 'classic', 'minimal']), so(d)));
    } else {
      const T = insetSides(inner, 0.3, 0, 0, 0);
      out.push(rule(R(inner.x + 0.05, T.y + T.h * 0.2, 0.012, T.h * 0.6), { shape: 'rect' }));
      out.push(...Z(c, T, 'plain', fitStack(T, ['editorial', 'formal', 'classic']), so(d, { align: 'left' })));
    }
    return out;
  },
  (p) => `${p.place}-${p.m < 0.3 ? 'wide' : 'deep'}`, { kinds: ['front', 'back', 'inside'] });

// Double-rule formal invitation.
fam(0, 'double-rule', 'framed', 'Double Rule',
  cross([{ gap: 0.1, m: 0.2 }, { gap: 0.32, m: 0.42 }], [{ corners: false }, { corners: true }], [{ place: 'center' }, { place: 'split' }]),
  (c, d, p) => {
    const A = inset(card(c), p.m);
    const B = inset(A, p.gap);
    const inner = safe(c, inset(B, c.u * (p.corners ? 0.18 : 0.12)));
    const out = [...frame(d, A, 'frame2'), ...frame(d, B, 'frame')];
    if (p.corners) out.push(...corners(c, inset(B, 0.06), d, c.u * 0.13));
    if (p.place === 'center') out.push(...Z(c, inner, 'plain', fitStack(inner, ['formal', 'names-first', 'monogram']), so(d)));
    else {
      const [top, bottom] = split(inner, c.L ? 'x' : 'y', [0.55, 0.45], 0.25);
      const key = fitStack(top, ['monogram', 'formal', 'classic']);
      out.push(...Z(c, top, 'plain', key, so(d)), ...Z(c, bottom, 'plain', fitStack(bottom, ['note', 'message-only', 'signoff'], rolesOf(key)), so(d)));
    }
    return out;
  },
  (p) => `${p.place}-${Math.round(p.gap * 100)}${p.corners ? '-corners' : ''}`, { kinds: ['front', 'back', 'inside'] });

// Split colour-block poster.
fam(0, 'color-block', 'split', 'Color Block',
  cross([{ side: 'top' }, { side: 'bottom' }, { side: 'left' }], [{ frac: 0.5 }, { frac: 0.38 }], [{ panel: 'invert' }, { panel: 'surface' }]),
  (c, d, p) => {
    const b = cardBand(c, p.side, p.frac, true);
    const bandKey = fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k));
    const out = [...Z(c, b.band, p.panel, bandKey, so(d))];
    const rest = safe(c, inset(b.main, 0.3));
    out.push(...Z(c, rest, 'plain', fitStack(rest, ['note', 'message-only', 'signoff'], rolesOf(bandKey)), so(d)));
    return out;
  },
  (p) => `${p.side}-${Math.round(p.frac * 100)}-${p.panel}`, { kinds: ['front', 'back', 'inside'] });

// Full-bleed pattern card with a plaque.
// A full-bleed dark card with light type: position, alignment and corner art vary.
fam(0, 'color-field', 'full-bleed', 'Color Field',
  cross([{ pos: 'upper' }, { pos: 'middle' }, { pos: 'lower' }], [{ align: 'center' }, { align: 'left' }], [{ deco: false }, { deco: true }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), c.u * (p.deco ? 0.16 : 0.1)));
    const h = A.h * 0.46;
    const T = p.pos === 'upper' ? R(A.x, A.y, A.w, h) : p.pos === 'lower' ? R(A.x, A.y + A.h - h, A.w, h) : R(A.x, A.y + (A.h - h) / 2, A.w, h);
    const out = [shape(card(c), { fill: '@text' })];
    if (p.deco) out.push(...corners(c, inset(card(c), c.u * 0.06), d, c.u * 0.12).map((e) => ({ ...e, color: '@background', color2: '@accent' })));
    out.push(...Z(c, T, 'plain', fitStack(T, prefs(d, 'large', p.k)), so(d, { align: p.align, ink: '@background', foil: false, ornColor: '@background' })));
    return out;
  },
  (p) => `${p.pos}-${p.align}${p.deco ? '-corners' : ''}`, { kinds: ['front', 'back', 'inside'] });
fam(0, 'pattern-plaque', 'full-bleed', 'Pattern Plaque',
  cross([{ pl: 'plaque' }, { pl: 'ellipse' }, { pl: 'invert' }], [{ size: 0.62 }, { size: 0.78 }], [{ at: 0.5 }, { at: 0.4 }]),
  (c, d, p) => {
    const out = [orn(d.scatter, card(c), { opacity: p.k % 2 ? 0.3 : 0.5 })];
    const w = c.W * p.size, h = p.pl === 'ellipse' ? w * (c.L ? 0.8 : 1) : Math.min(c.H * 0.5, w * (c.L ? 0.62 : 0.85));
    const cy = c.H * p.at;
    const pr = p.pl === 'ellipse' ? fitAspect(box(c.W / 2, cy, w, Math.min(h, c.H * 0.7)), 1) : box(c.W / 2, cy, w, h);
    // A visible panel over the pattern: a framed surface card, a surface oval or a dark block.
    if (p.pl === 'invert') {
      out.push(...Z(c, pr, 'invert', fitStack(inset(pr, 0.25), prefs(d, 'tile', p.k)), so(d, { radius: 0.1 })));
    } else {
      out.push(shape(pr, { shape: p.pl === 'ellipse' ? 'ellipse' : 'rect', fill: '@surface', radius: p.pl === 'plaque' ? 0.08 : 0 }));
      if (p.pl === 'plaque') out.push(...frame(d, inset(pr, 0.09)));
      const inner = p.pl === 'ellipse' ? inset(pr, pr.w * 0.17, pr.h * 0.2) : inset(pr, 0.28);
      out.push(...Z(c, inner, 'plain', fitStack(inner, prefs(d, 'tile', p.k)), so(d)));
    }
    return out;
  },
  (p) => `${p.pl}-${Math.round(p.size * 100)}${p.at < 0.5 ? '-high' : ''}`);

// Minimal corner-aligned greeting.
fam(0, 'corner-greeting', 'typography', 'Corner Greeting',
  cross([{ at: 'bl' }, { at: 'tl' }, { at: 'br' }, { at: 'tr' }], [{ st: 'minimal' }, { st: 'editorial' }], [{ icon: true }, { icon: false }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), 0.1));
    const w = A.w * (c.L ? 0.5 : 0.72), h = A.h * (c.L ? 0.42 : 0.34);
    const left = p.at[1] === 'l', top = p.at[0] === 't';
    const r = R(left ? A.x : A.x + A.w - w, top ? A.y : A.y + A.h - h, w, h);
    const out = [...Z(c, r, 'plain', fitStack(r, [p.st, 'minimal']), so(d, { align: left ? 'left' : 'right' }))];
    if (p.icon) {
      const s = c.u * 0.18;
      out.push(orn(d.icon, R(left ? A.x + A.w - s : A.x, top ? A.y + A.h - s : A.y, s, s)));
    }
    return out;
  },
  (p) => `${p.at}-${p.st}${p.icon ? '-icon' : ''}`, { kinds: ['front', 'inside'] });

// Postcard message card (back-style front): message left, address lines right.
fam(0, 'postcard', 'postcard', 'Postcard Note',
  cross([{ split: 0.55 }, { split: 0.6 }, { split: 0.5 }], [{ stamp: 'icon' }, { stamp: 'surface' }], [{ st: 'message' }, { st: 'letter-short' }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), 0.12));
    const vertical = !c.P;
    const [msg, addr] = vertical ? split(A, 'x', [p.split, 1 - p.split], 0.3) : split(A, 'y', [p.split, 1 - p.split], 0.3);
    const out = [...Z(c, msg, 'plain', fitStack(msg, [p.st, 'message', 'classic']), so(d, { align: 'left' }))];
    // Divider between the halves.
    out.push(vertical ? rule(R(msg.x + msg.w + 0.145, A.y + A.h * 0.08, 0.01, A.h * 0.84), { shape: 'rect', fill: '@textMuted' }) : rule(R(A.x + A.w * 0.08, msg.y + msg.h + 0.145, A.w * 0.84, 0.01), { shape: 'rect', fill: '@textMuted' }));
    const s = Math.min(addr.w, addr.h) * 0.34;
    const stampR = R(addr.x + addr.w - s * 0.82, addr.y, s * 0.82, s);
    out.push(p.stamp === 'icon' ? orn(d.icon, stampR) : shape(stampR, { fill: '@surface', radius: 0.03 }));
    if (p.stamp === 'surface') out.push(orn(d.icon, inset(stampR, s * 0.15)));
    const lines = R(addr.x, addr.y + s + 0.15, addr.w, addr.h - s - 0.15);
    for (let i = 0; i < 4; i++) out.push(rule(R(lines.x, lines.y + (lines.h / 4) * (i + 0.7), lines.w, 0.02), { fill: '@textMuted' }));
    return out;
  },
  (p) => `${Math.round(p.split * 100)}-${p.stamp}-${p.st}`, { kinds: ['front', 'back'] });

// Family update letter.
// Letters: the header moves (top, beside, on a dark band, under a crest, a year column, a panel).
fam(0, 'letter', 'letter', 'Family Letter',
  cross([{ head: 'top' }, { head: 'side' }, { head: 'band' }, { head: 'crest' }, { head: 'year' }, { head: 'panel' }], [{ m: 0.5 }, { m: 1.0 }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), p.m * 0.6));
    const left = so(d, { align: 'left' });
    const out = [];
    if (p.head === 'top') {
      out.push(...Z(c, A, 'plain', 'letter', left));
      const s = c.u * 0.12;
      out.push(p.m < 0.7 ? orn(d.div, R(A.x, Math.max(0.1, A.y - 0.2), Math.min(A.w * 0.4, 1.6), 0.16)) : orn(d.icon, R(A.x + A.w - s, A.y, s, s)));
    } else if (p.head === 'side' || p.head === 'year') {
      const across = !c.P;
      const [h, b] = split(A, across ? 'x' : 'y', across ? [0.38, 0.62] : [0.3, 0.7], 0.3);
      const headKey = fitStack(h, p.head === 'year' ? ['year-first', 'big-year', 'editorial'] : ['crest', 'editorial', 'classic']);
      out.push(...Z(c, h, 'plain', headKey, so(d, { align: p.head === 'year' && !across ? 'center' : 'left' })));
      out.push(...Z(c, b, 'plain', fitStack(b, ['letter-body', 'body'], rolesOf(headKey)), left));
      if (across) out.push(rule(R(h.x + h.w + 0.145, b.y + b.h * 0.1, 0.01, b.h * 0.8), { shape: 'rect' }));
    } else if (p.head === 'band') {
      const band = R(0, 0, c.W, c.H * (c.L ? 0.26 : 0.2));
      out.push(...Z(c, band, 'invert', fitStack(safe(c, inset(band, 0.2)), ['caption', 'headline']), so(d)));
      const B = safe(c, insetSides(card(c), p.m * 0.6, band.h + 0.25, p.m * 0.6, p.m * 0.6));
      out.push(...Z(c, B, 'plain', fitStack(B, ['letter-body', 'body']), left));
    } else if (p.head === 'crest') {
      const [h, b] = split(A, 'y', c.L ? [0.4, 0.6] : [0.32, 0.68], 0.25);
      out.push(...Z(c, h, 'plain', fitStack(h, ['crest', 'formal', 'minimal']), so(d)));
      out.push(...Z(c, b, 'plain', 'body', so(d, { align: 'center' })));
    } else {
      const P = inset(card(c), 0.25 + p.m * 0.2);
      out.push(...Z(c, P, 'surface', 'letter', so(d, { align: 'left', radius: 0.06 })));
      out.push(...corners(c, inset(P, -0.12), d, Math.min(0.5, c.u * 0.09)));
    }
    return out;
  },
  (p) => `${p.head}-${p.m < 0.7 ? 'wide' : 'narrow'}`, { kinds: ['back', 'inside', 'front'] });

// A light window cut into a coloured card with the greeting inside it.
fam(0, 'cameo', 'cutout', 'Cameo Window',
  cross([{ win: 'circle' }, { win: 'oval' }, { win: 'wide' }], [{ back: 'full' }, { back: 'band' }], [{ at: 0.5 }, { at: 0.42 }]),
  (c, d, p) => {
    const cy = c.H * p.at;
    const W = p.win === 'circle' ? sq(c.W / 2, cy, Math.min(c.W, c.H) * 0.78)
      : p.win === 'oval' ? box(c.W / 2, cy, c.W * (c.L ? 0.54 : 0.76), c.H * (c.L ? 0.8 : 0.66))
        : box(c.W / 2, cy, c.W * (c.L ? 0.82 : 0.86), c.H * (c.L ? 0.56 : 0.42));
    const k = Math.SQRT1_2;
    const inner = safe(c, box(c.W / 2, cy, W.w * k, W.h * k));
    const bg = p.k % 2 ? '@text' : '@surface';
    const back = p.back === 'full' ? card(c) : c.L ? R(W.x - 0.35, 0, W.w + 0.7, c.H) : R(0, W.y - 0.35, c.W, W.h + 0.7);
    return [
      shape(back, { fill: bg }),
      shape(W, { shape: 'ellipse', fill: '@background' }),
      ...Z(c, inner, 'plain', fitStack(inner, ['crest', 'formal', 'classic', 'minimal']), so(d)),
    ];
  },
  (p) => `${p.win}-${p.back}${p.at < 0.5 ? '-high' : ''}`, { kinds: ['front', 'back', 'inside'] });

// Giant year numerals.
fam(0, 'giant-year', 'typography', 'Giant Year',
  cross([{ st: 'big-year' }, { st: 'year-first' }], [{ align: 'center' }, { align: 'left' }], [{ band: false }, { band: true }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), 0.15));
    const out = [];
    if (p.band) out.push(shape(R(0, c.H * 0.36, c.W, c.H * 0.28), { fill: '@surface' }));
    out.push(...Z(c, A, 'plain', p.st, so(d, { align: p.align })));
    return out;
  },
  (p) => `${p.st}-${p.align}${p.band ? '-band' : ''}`);

// Diagonal / geometric accent bands.
fam(0, 'diagonal', 'collage', 'Diagonal Bands',
  cross([{ ang: -18 }, { ang: 18 }, { ang: -32 }], [{ n: 1 }, { n: 2 }], [{ pl: 'plaque' }, { pl: 'framed' }]),
  (c, d, p) => {
    const out = [];
    const len = Math.hypot(c.W, c.H) * 0.9;
    const t = c.u * 0.13;
    for (let i = 0; i < p.n; i++) {
      const cy = p.n === 1 ? c.H * 0.5 : c.H * (0.3 + i * 0.4);
      out.push(shape(box(c.W / 2, cy, Math.min(len, c.W * 0.96), t * (i ? 0.45 : 1)), { fill: i ? '@accent2' : '@accent', rotation: p.ang, opacity: 0.85 }));
    }
    const pr = box(c.W / 2, c.H / 2, c.W * 0.62, c.H * (c.L ? 0.5 : 0.36));
    // The panel goes over the ribbons so the type never sits on them.
    if (p.pl === 'framed') out.push(shape(inset(pr, -0.05), { fill: '@background' }), ...frame(d, inset(pr, 0.04), 'frame'));
    if (p.pl === 'plaque') out.push(...Z(c, pr, 'plaque', fitStack(inset(pr, 0.2), prefs(d, 'badge', p.k)), so(d)));
    else { const zr = inset(pr, 0.3); out.push(...Z(c, zr, 'plain', fitStack(zr, prefs(d, 'badge', p.k)), so(d))); }
    return out;
  },
  (p) => `${p.ang < 0 ? 'down' : 'up'}${Math.abs(p.ang)}-${p.n}-${p.pl}`);

// Geometric shape collage (overlapping circles/rectangles).
fam(0, 'geo', 'collage', 'Geometric Collage',
  cross([{ arr: 'circles' }, { arr: 'blocks' }, { arr: 'stripes' }], [{ side: 'top' }, { side: 'bottom' }]),
  (c, d, p) => {
    const out = [];
    const top = p.side === 'top';
    const zoneH = c.H * (c.L ? 0.42 : 0.38);
    const deco = R(0, top ? 0 : c.H - zoneH, c.W, zoneH);
    if (p.arr === 'circles') {
      const s = Math.min(deco.h * 0.8, c.W * 0.34);
      [[0.3, '@accent', 0.85], [0.5, '@accent2', 0.75], [0.7, '@surface', 1]].forEach(([fx, f, op], i) => out.push(shape(sq(c.W * fx, deco.y + deco.h / 2 + (i - 1) * s * 0.08, s), { shape: 'ellipse', fill: f, opacity: op })));
    } else if (p.arr === 'blocks') {
      out.push(shape(R(deco.x + c.W * 0.08, deco.y + deco.h * 0.15, c.W * 0.5, deco.h * 0.7), { fill: '@accent', opacity: 0.85 }));
      out.push(shape(R(deco.x + c.W * 0.4, deco.y + deco.h * 0.3, c.W * 0.5, deco.h * 0.55), { fill: '@surface' }));
      out.push(shape(R(deco.x + c.W * 0.3, deco.y + deco.h * 0.45, c.W * 0.22, deco.h * 0.4), { fill: '@accent2', opacity: 0.8 }));
    } else {
      // Layered bands from the edge inwards: accent, accent2, then a wide surface band.
      let at = 0;
      [[0.3, '@accent', 0.85], [0.14, '@accent2', 0.8], [0.36, '@surface', 1]].forEach(([f, fill, opacity]) => {
        const h = deco.h * f;
        out.push(shape(R(0, top ? at : c.H - at - h, c.W, h), { fill, opacity }));
        at += h;
      });
    }
    const tz = safe(c, R(c.W * 0.1, top ? deco.y + deco.h + 0.15 : c.H * 0.08, c.W * 0.8, c.H - zoneH - 0.15 - c.H * 0.1));
    out.push(...Z(c, tz, 'plain', fitStack(tz, prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.arr}-${p.side}`);

/* ------------------------------------------------------------------------------------------ */
/* 1 PHOTO                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const ONE_ZONES = [
  { z: 'bottom', f: 0.34 }, { z: 'bottom', f: 0.46 }, { z: 'top', f: 0.32 }, { z: 'left', f: 0.5 }, { z: 'right', f: 0.5 },
  { z: 'center', f: 0.3 }, { z: 'radial', f: 0.6 }, { z: 'badge-bl' }, { z: 'badge-br' }, { z: 'plaque' }, { z: 'ellipse' }, { z: 'band-low' },
];

// Full-bleed photo with varied scrims and captions.
fam(1, 'fb', 'full-bleed', 'Full Bleed',
  cross(ONE_ZONES, [{ al: 'center' }, { al: 'left' }]).filter((p) => !(p.al === 'left' && ['center', 'radial', 'plaque', 'ellipse', 'right'].includes(p.z))),
  (c, d, p) => {
    const A = card(c);
    const fa = { bottom: { x: 0, y: 0, w: 1, h: 1 - p.f }, top: { x: 0, y: p.f, w: 1, h: 1 - p.f }, left: { x: p.f, y: 0, w: 1 - p.f, h: 1 }, right: { x: 0, y: 0, w: 1 - p.f, h: 1 } }[p.z];
    const out = [photo(0, A, fa ? { focusArea: fa } : {})];
    const k = p.k;
    if (['bottom', 'top', 'left', 'right'].includes(p.z)) {
      const f = p.z === 'left' || p.z === 'right' ? (c.P ? Math.max(p.f, 0.62) : p.f) : c.L ? p.f * 1.1 : p.f;
      const sr = p.z === 'bottom' ? R(0, c.H * (1 - f), c.W, c.H * f) : p.z === 'top' ? R(0, 0, c.W, c.H * f) : p.z === 'left' ? R(0, 0, c.W * f, c.H) : R(c.W * (1 - f), 0, c.W * f, c.H);
      const tr = p.z === 'bottom' ? insetSides(sr, 0, sr.h * 0.3, 0, 0) : p.z === 'top' ? insetSides(sr, 0, 0, 0, sr.h * 0.3) : p.z === 'left' ? insetSides(sr, 0, sr.h * 0.3, sr.w * 0.2, 0) : insetSides(sr, sr.w * 0.2, sr.h * 0.3, 0, 0);
      out.push(...Z(c, tr, `scrim-${p.z}`, fitStack(inset(tr, 0.2), prefs(d, 'overlay', k)), so(d, { scrimRect: sr, align: p.z === 'right' ? 'right' : p.al })));
    } else if (p.z === 'center') {
      const sr = R(0, c.H * 0.35, c.W, c.H * p.f);
      out.push(...Z(c, inset(sr, 0, 0.05), 'scrim-center', fitStack(inset(sr, 0.3, 0.1), prefs(d, 'overlay', k)), so(d, { scrimRect: sr })));
    } else if (p.z === 'radial') {
      const sr = box(c.W / 2, c.H / 2, c.W * 0.95, c.H * p.f);
      const tr = box(c.W / 2, c.H / 2, c.W * 0.6, c.H * p.f * 0.55);
      out.push(...Z(c, tr, 'scrim-radial', fitStack(tr, prefs(d, 'overlay', k)), so(d, { scrimRect: sr })));
    } else if (p.z === 'badge-bl' || p.z === 'badge-br') {
      const w = c.W * (c.L ? 0.4 : 0.56), h = c.H * (c.L ? 0.3 : 0.2);
      const r = R(p.z === 'badge-bl' ? c.sx : c.W - c.sx - w, c.H - c.sy - h, w, h);
      out.push(...Z(c, r, 'plaque', fitStack(inset(r, 0.15), prefs(d, 'badge', k)), so(d, { radius: 0.06, align: p.al })));
    } else if (p.z === 'plaque' || p.z === 'ellipse') {
      const w = c.W * (p.z === 'ellipse' ? 0.6 : 0.66);
      const h = p.z === 'ellipse' ? Math.min(w, c.H * 0.6) : c.H * (c.L ? 0.4 : 0.28);
      const r = p.z === 'ellipse' ? fitSquare(box(c.W / 2, c.H * 0.6, w, h)) : box(c.W / 2, c.H * 0.62, w, h);
      out.push(...Z(c, r, p.z, fitStack(inset(r, 0.2), prefs(d, 'badge', k)), so(d)));
    } else if (p.z === 'band-low') {
      const r = R(0, c.H * 0.7, c.W, c.H * 0.2);
      out.push(...Z(c, r, 'plaque', fitStack(inset(r, 0.25, 0.1), prefs(d, 'overlay', k)), so(d, { radius: 0 })));
    }
    return out;
  },
  (p) => `${p.z}${p.f ? `-${Math.round(p.f * 100)}` : ''}${p.al === 'left' ? '-left' : ''}`);

// Editorial split: photo takes a share of the long side, the greeting gets the rest.
fam(1, 'split', 'split', 'Editorial Split',
  cross([{ r: 0.5 }, { r: 0.62 }, { r: 0.7 }], [{ side: 'bottom' }, { side: 'top' }, { side: 'right' }], [{ panel: 'plain' }, { panel: 'surface' }, { panel: 'invert' }])
    .filter((p) => !(p.side === 'right' && p.r === 0.7)),
  (c, d, p) => {
    const b = cardBand(c, p.side, 1 - p.r);
    const out = [photo(0, b.main)];
    out.push(...Z(c, b.band, p.panel, fitStack(inset(b.band, 0.25), prefs(d, 'band', p.k)), so(d, { align: p.side === 'right' && p.panel === 'plain' ? 'left' : 'center' })));
    return out;
  },
  (p) => `${p.side}-${Math.round(p.r * 100)}-${p.panel}`);

// Museum mat / framed photo.
fam(1, 'framed', 'framed', 'Gallery Frame',
  cross([{ m: 0.3 }, { m: 0.45 }, { m: 0.62 }], [{ tx: 'below' }, { tx: 'above' }, { tx: 'side' }], [{ fs: 'none' }, { fs: 'mat' }, { fs: 'keyline' }]),
  (c, d, p) => {
    const m = p.m;
    const tFrac = p.tx === 'side' ? 0.36 : 0.28;
    const side = p.tx === 'below' ? 'bottom' : p.tx === 'above' ? 'top' : 'right';
    const b = cardBand(c, side, tFrac);
    const pr = insetSides(b.main, m, b.s === 'top' ? 0.05 : m, b.s === 'left' ? 0.05 : m, b.s === 'bottom' ? 0.05 : m);
    // Keep the photo off the band edge cleanly.
    const fixed = b.s === 'bottom' ? R(pr.x, pr.y, pr.w, b.main.h - m - 0.05) : b.s === 'top' ? R(pr.x, b.main.y + 0.05, pr.w, b.main.h - m - 0.05) : b.s === 'right' ? R(pr.x, pr.y, b.main.w - m - 0.05, pr.h) : R(b.main.x + 0.05, pr.y, b.main.w - m - 0.05, pr.h);
    const out = [];
    if (p.fs === 'keyline') out.push(...frame(d, inset(fixed, -0.1)));
    out.push(photo(0, fixed, p.fs === 'mat' ? { frameStyle: 'mat', shadow: true } : {}));
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.tx}-${Math.round(p.m * 100)}-${p.fs}`);

// Cut-out masks with varied headline placement.
fam(1, 'cutout', 'cutout', 'Cut-out',
  cross([{ mask: 'arch' }, { mask: 'circle' }, { mask: 'ellipse' }, { mask: 'scallop' }, { mask: 'heart' }, { mask: 'rounded' }, { mask: 'stamp' }], [{ tx: 'below' }, { tx: 'above' }, { tx: 'side' }, { tx: 'overlap' }]),
  (c, d, p) => {
    const out = [];
    const side = p.tx === 'below' ? 'bottom' : p.tx === 'above' ? 'top' : p.tx === 'side' ? 'right' : 'bottom';
    const frac = p.tx === 'overlap' ? 0.24 : p.tx === 'side' ? 0.42 : 0.32;
    const b = cardBand(c, side, frac);
    let area = inset(b.main, c.u * 0.09);
    if (p.tx === 'overlap') area = c.L ? inset(card(c), c.u * 0.09) : insetSides(card(c), c.u * 0.09, c.u * 0.09, c.u * 0.09, c.H * 0.14);
    const shapeAspect = { arch: 0.74, circle: 1, heart: 1.05, ellipse: 0.78, scallop: 0.8, rounded: 0.78, stamp: 0.8 }[p.mask];
    const pr = fitAspect(area, c.L && p.mask !== 'circle' && p.mask !== 'heart' && p.tx === 'overlap' ? 1.3 : shapeAspect);
    out.push(photo(0, pr, { ...maskOpts(p.mask, 0.3), shadow: p.mask !== 'stamp' }));
    if (p.tx === 'overlap') {
      const w = pr.w * 0.9, h = Math.max(1.2, c.H * 0.2);
      const r = box(pr.x + pr.w / 2, Math.min(pr.y + pr.h, c.H - c.sy - h / 2) , w, h);
      out.push(...Z(c, r, 'plaque', fitStack(inset(r, 0.15), prefs(d, 'badge', p.k)), so(d, { radius: 0.05 })));
    } else {
      out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    }
    return out;
  },
  (p) => `${p.mask}-${p.tx}`, { affinity: ['mask'] });

// Tilted snapshot / postage-stamp frame.
fam(1, 'snapshot', 'collage', 'Snapshot',
  cross([{ fs: 'polaroid', rot: -5 }, { fs: 'polaroid', rot: 4 }, { fs: 'polaroid', rot: 0 }, { fs: 'stamp', rot: -3 }, { fs: 'mat', rot: 3 }], [{ tx: 'below' }, { tx: 'side' }, { tx: 'top' }]),
  (c, d, p) => {
    const side = p.tx === 'below' ? 'bottom' : p.tx === 'top' ? 'top' : 'right';
    const b = cardBand(c, side, p.tx === 'side' ? 0.42 : 0.3);
    const area = inset(b.main, c.u * 0.14);
    const asp = p.fs === 'polaroid' ? 0.84 : 0.8;
    const pr = fitAspect(area, asp);
    const out = [];
    if (d.scatter && p.k % 2 === 0) out.push(orn(d.scatter, b.main, { opacity: 0.22 }));
    out.push(photo(0, pr, p.fs === 'stamp' ? { mask: 'stamp', rotation: p.rot, shadow: true } : { frameStyle: p.fs, shadow: true, rotation: p.rot }));
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.fs}${p.rot ? (p.rot < 0 ? '-l' : '-r') : ''}-${p.tx}`);

// Postcard: photo + message column with address lines and stamp.
fam(1, 'postcard', 'postcard', 'Postcard',
  cross([{ r: 0.5 }, { r: 0.58 }], [{ ph: 'first' }, { ph: 'second' }], [{ fb: true }, { fb: false }]),
  (c, d, p) => {
    const A = card(c);
    const axis = c.P ? 'y' : 'x';
    const parts = split(A, axis, p.ph === 'first' ? [p.r, 1 - p.r] : [1 - p.r, p.r]);
    const [pa, ta] = p.ph === 'first' ? parts : [parts[1], parts[0]];
    const out = [photo(0, p.fb ? pa : inset(pa, 0.22))];
    const T = safe(c, inset(ta, 0.22));
    const [msg, addr] = split(T, axis === 'y' ? 'x' : 'y', [0.56, 0.44], 0.2);
    out.push(...Z(c, msg, 'plain', fitStack(msg, ['message', 'classic', 'minimal']), so(d, { align: 'left' })));
    const s = Math.min(addr.w * 0.36, addr.h * 0.4);
    out.push(orn(d.icon, R(addr.x + addr.w - s, addr.y, s, s)));
    const lines = R(addr.x, addr.y + s + 0.1, addr.w, addr.h - s - 0.1);
    for (let i = 0; i < 3; i++) out.push(rule(R(lines.x, lines.y + (lines.h / 3) * (i + 0.6), lines.w, 0.02), { fill: '@textMuted' }));
    return out;
  },
  (p) => `${p.ph}-${Math.round(p.r * 100)}${p.fb ? '-bleed' : ''}`, { kinds: ['front', 'back'] });

// Letter with one photo.
fam(1, 'letter', 'letter', 'Photo Letter',
  cross([{ ph: 'top' }, { ph: 'corner' }, { ph: 'circle' }], [{ size: 0.4 }, { size: 0.3 }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), 0.18));
    const out = [];
    if (p.ph === 'top') {
      const [pr, tr] = split(A, c.L ? 'x' : 'y', [p.size, 1 - p.size], 0.25);
      out.push(photo(0, pr, maskOpts('rounded', 0.08)), ...Z(c, tr, 'plain', fitStack(tr, ['letter', 'letter-short', 'message']), so(d, { align: 'left' })));
    } else {
      const s = Math.min(A.w, A.h) * p.size;
      const pr = p.ph === 'circle' ? R(A.x + A.w - s, A.y, s, s) : R(A.x, A.y, s * 1.2, s);
      out.push(photo(0, pr, p.ph === 'circle' ? { mask: 'circle' } : { frameStyle: 'polaroid', rotation: -3, shadow: true }));
      const head = p.ph === 'circle' ? R(A.x, A.y, A.w - s - 0.2, s) : R(A.x + s * 1.2 + 0.25, A.y, A.w - s * 1.2 - 0.25, s);
      const headKey = fitStack(head, ['editorial', 'minimal', 'headline']);
      out.push(...Z(c, head, 'plain', headKey, so(d, { align: 'left' })));
      const body = R(A.x, A.y + s + 0.2, A.w, A.h - s - 0.2);
      out.push(...Z(c, body, 'plain', fitStack(body, ['letter-body', 'note', 'body'], rolesOf(headKey)), so(d, { align: 'left' })));
    }
    return out;
  },
  (p) => `${p.ph}-${Math.round(p.size * 100)}`, { kinds: ['back', 'inside', 'front'] });

// Type-led: big greeting, small photo.
fam(1, 'typo', 'typography', 'Type First',
  cross([{ ph: 'circle' }, { ph: 'strip' }, { ph: 'arch' }], [{ at: 'bottom' }, { at: 'top' }]),
  (c, d, p) => {
    const A = safe(c, inset(card(c), 0.1));
    const out = [];
    const ph = p.ph === 'strip' ? (c.L ? 0.3 : 0.26) : c.L ? 0.42 : 0.36;
    const [a, b] = split(A, c.L ? 'x' : 'y', p.at === 'bottom' ? [1 - ph, ph] : [ph, 1 - ph], 0.25);
    const [pa, ta] = p.at === 'bottom' ? [b, a] : [a, b];
    const pr = p.ph === 'strip' ? pa : fitAspect(pa, p.ph === 'circle' ? 1 : 0.8);
    out.push(photo(0, pr, p.ph === 'strip' ? {} : { mask: p.ph }));
    out.push(...Z(c, ta, 'plain', fitStack(ta, prefs(d, 'large', p.k)), so(d)));
    return out;
  },
  (p) => `${p.ph}-${p.at}`);

// Layered: photo with an offset colour block.
fam(1, 'layered', 'collage', 'Layered Block',
  cross([{ off: 'dr' }, { off: 'ul' }], [{ tx: 'below' }, { tx: 'side' }], [{ fill: '@accent' }, { fill: '@surface' }]),
  (c, d, p) => {
    const b = cardBand(c, p.tx === 'below' ? 'bottom' : 'right', p.tx === 'below' ? 0.3 : 0.4);
    const area = inset(b.main, c.u * 0.12);
    const o = c.u * 0.06;
    const pr = insetSides(area, p.off === 'ul' ? o : 0, p.off === 'ul' ? o : 0, p.off === 'dr' ? o : 0, p.off === 'dr' ? o : 0);
    const blk = R(pr.x + (p.off === 'dr' ? o : -o), pr.y + (p.off === 'dr' ? o : -o), pr.w, pr.h);
    return [shape(blk, { fill: p.fill, opacity: 0.9 }), photo(0, pr), ...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d))];
  },
  (p) => `${p.off}-${p.tx}-${p.fill === '@accent' ? 'accent' : 'soft'}`);

/* ------------------------------------------------------------------------------------------ */
/* 2–6 PHOTOS: mosaic-based families                                                            */
/* ------------------------------------------------------------------------------------------ */

const TEXT_BANDS = [
  { text: { mode: 'band', side: 'bottom', frac: 0.26 } },
  { text: { mode: 'band', side: 'top', frac: 0.24 } },
  { text: { mode: 'band', side: 'bottom', frac: 0.26, backing: 'surface' } },
];
const TEXT_OVER = [
  { text: { mode: 'overlay', side: 'bottom', frac: 0.34 } },
  { text: { mode: 'badge', badge: 'plaque' } },
  { text: { mode: 'badge', badge: 'ellipse' } },
];

/** Register a mosaic family: trees × styles × text treatments. */
function mosaicFam(n, key, cat, title, trees, styles, texts, opts = {}) {
  const variants = [];
  for (const t of trees) for (const s of styles) for (const tx of texts) variants.push({ tree: t.tree, tname: t.name, ...s, ...tx, sname: s.name ?? '' });
  fam(n, key, cat, title, variants, (c, d, p) => mosaic(c, d, p),
    (p) => [p.tname, p.sname, p.text.mode === 'band' ? `${p.text.side}${p.text.backing ? '-' + p.text.backing : ''}` : p.text.mode === 'badge' ? `badge-${p.text.badge}` : p.text.mode === 'overlay' ? 'overlay' : p.text.mode].filter(Boolean).join('-'),
    opts);
}

const FLUSH = { m: 0, g: 0, name: 'flush' };
const THIN = { m: 0, g: 0.06, name: 'thin' };
const FRAMED = { m: 0.25, g: 0.1, name: 'framed' };
const WIDE = { m: 0.38, g: 0.16, name: 'wide', deco: 'corners' };
const ROUND = { m: 0.25, g: 0.12, mask: 'rounded', radius: 0.14, name: 'rounded' };
const MAT = { m: 0.3, g: 0.14, frameStyle: 'mat', name: 'mat' };
const KEYLINE = { m: 0.32, g: 0.1, name: 'keyline', deco: 'frame' };

/* ---------------- 2 photos ---------------- */
mosaicFam(2, 'duo', 'full-bleed', 'Duo',
  [{ name: 'stack', tree: ['y', [1, 1], ['p', 'p']] }, { name: 'side', tree: ['x', [1, 1], ['p', 'p']] }, { name: 'stack-6040', tree: ['y', [3, 2], ['p', 'p']] }],
  [FLUSH, THIN], TEXT_OVER);
mosaicFam(2, 'duo-framed', 'framed', 'Framed Duo',
  [{ name: 'stack', tree: ['y', [1, 1], ['p', 'p']] }, { name: 'side', tree: ['x', [1, 1], ['p', 'p']] }, { name: 'asym', tree: ['y', [13, 7], ['p', 'p']] }],
  [FRAMED, MAT, KEYLINE, WIDE], TEXT_BANDS.slice(0, 2));
mosaicFam(2, 'duo-split', 'split', 'Duo Split',
  [{ name: 'stack', tree: ['y', [1, 1], ['p', 'p']] }, { name: '7030', tree: ['y', [7, 3], ['p', 'p']] }, { name: 'side', tree: ['x', [1, 1], ['p', 'p']] }],
  [THIN, FLUSH],
  [{ text: { mode: 'band', side: 'bottom', frac: 0.38, backing: 'invert' } }, { text: { mode: 'band', side: 'right', frac: 0.4, backing: 'surface' } }, { text: { mode: 'band', side: 'top', frac: 0.36 } }]);
mosaicFam(2, 'duo-cutout', 'cutout', 'Twin Cut-outs',
  [{ name: 'pair', tree: ['x', [1, 1], ['p', 'p']] }],
  [{ m: 0.3, g: 0.2, mask: 'arch', name: 'arches' }, { m: 0.3, g: 0.2, mask: 'ellipse', name: 'ovals' }, { m: 0.3, g: 0.2, mask: 'circle', name: 'circles' }, { m: 0.3, g: 0.2, mask: 'scallop', name: 'scallops' }, { m: 0.3, g: 0.2, mask: 'heart', name: 'hearts' }, { m: 0.3, g: 0.2, mask: 'stamp', name: 'stamps' }],
  [{ text: { mode: 'band', side: 'bottom', frac: 0.36, keep: true } }, { text: { mode: 'band', side: 'top', frac: 0.34, keep: true } }], { affinity: ['mask'] });

// Full-bleed hero with a floating inset.
fam(2, 'hero-inset', 'full-bleed', 'Hero + Inset',
  cross([{ at: 'br' }, { at: 'tr' }, { at: 'bl' }, { at: 'tl' }], [{ st: 'polaroid' }, { st: 'circle' }, { st: 'mat' }]),
  (c, d, p) => {
    const out = [photo(0, card(c))];
    const s = c.u * (p.st === 'circle' ? 0.36 : 0.38);
    const asp = p.st === 'circle' ? 1 : p.st === 'polaroid' ? 0.84 : 1.2;
    const w = p.st === 'circle' ? s : s * asp, h = p.st === 'circle' ? s : s;
    const right = p.at[1] === 'r', bottom = p.at[0] === 'b';
    const mx = c.u * 0.08;
    const ir = R(right ? c.W - mx - w : mx, bottom ? c.H - c.H * 0.08 - h : c.H * 0.08, w, h);
    out.push(photo(1, ir, p.st === 'circle' ? { mask: 'circle', shadow: true } : { frameStyle: p.st, shadow: true, rotation: p.st === 'polaroid' ? (right ? 4 : -4) : 0 }));
    // Text on the opposite side.
    const tSide = bottom ? 'top' : 'bottom';
    const f = 0.34;
    const sr = tSide === 'bottom' ? R(0, c.H * (1 - f), c.W, c.H * f) : R(0, 0, c.W, c.H * f);
    const trr = tSide === 'bottom' ? insetSides(sr, 0, sr.h * 0.3, 0, 0) : insetSides(sr, 0, 0, 0, sr.h * 0.3);
    out.push(...Z(c, trr, `scrim-${tSide}`, fitStack(inset(trr, 0.2), prefs(d, 'overlay', p.k)), so(d, { scrimRect: sr, align: right ? 'left' : 'right' })));
    return out;
  },
  (p) => `${p.st}-${p.at}`);

// Overlapping tilted polaroids.
fam(2, 'polaroids', 'collage', 'Polaroid Pair',
  cross([{ lay: 'diag' }, { lay: 'side' }, { lay: 'stack' }], [{ tx: 'bottom' }, { tx: 'top' }], [{ sc: true }, { sc: false }]),
  (c, d, p) => {
    const b = cardBand(c, p.tx, 0.28);
    const A = inset(b.main, c.u * 0.1);
    const out = [];
    if (p.sc && d.scatter) out.push(orn(d.scatter, b.main, { opacity: 0.25 }));
    const s = Math.min(A.w, A.h) * (p.lay === 'side' ? 0.56 : 0.62);
    const w = s * 0.84, h = s;
    const pos = p.lay === 'diag' ? [[0.33, 0.36, -6], [0.67, 0.64, 5]] : p.lay === 'side' ? [[0.3, 0.5, -5], [0.7, 0.5, 4]] : [[0.5, 0.33, -4], [0.5, 0.67, 5]];
    const rects = pos.map(([fx, fy]) => box(A.x + A.w * fx, A.y + A.h * fy, w, h));
    pos.forEach(([, , r], i) => out.push(photo(i, rects[i], { frameStyle: 'polaroid', shadow: true, rotation: r })));
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.lay}-${p.tx}${p.sc ? '-confetti' : ''}`);

// Diagonal staggered gallery duo.
fam(2, 'stagger', 'collage', 'Staggered Duo',
  cross([{ dir: 'down' }, { dir: 'up' }], [{ mask: 'rect' }, { mask: 'rounded' }, { mask: 'arch' }], [{ tx: 'corner' }, { tx: 'band' }]),
  (c, d, p) => {
    const out = [];
    const A = inset(card(c), c.u * 0.1);
    const w = A.w * (c.L ? 0.42 : 0.56), h = A.h * (c.L ? 0.62 : 0.44);
    const r0 = p.dir === 'down' ? R(A.x, A.y, w, h) : R(A.x, A.y + A.h - h, w, h);
    const r1 = p.dir === 'down' ? R(A.x + A.w - w, A.y + A.h - h - (p.tx === 'band' ? A.h * 0.0 : 0), w, h) : R(A.x + A.w - w, A.y, w, h);
    out.push(photo(0, r0, maskOpts(p.mask, 0.16)), photo(1, r1, maskOpts(p.mask, 0.16)));
    // Text in the empty diagonal corners.
    const tr = p.dir === 'down' ? R(A.x + w + 0.15, A.y, A.w - w - 0.15, A.h - h - 0.15) : R(A.x + w + 0.15, A.y + h + 0.15, A.w - w - 0.15, A.h - h - 0.15);
    const tl = p.dir === 'down' ? R(A.x, A.y + h + 0.15, A.w - w - 0.15, A.h - h - 0.15) : R(A.x, A.y, A.w - w - 0.15, A.h - h - 0.15);
    const main = tr.w * tr.h > tl.w * tl.h ? tr : tl;
    out.push(...Z(c, main, p.tx === 'band' ? 'surface' : 'plain', fitStack(inset(main, 0.15), prefs(d, 'tile', p.k)), so(d, { align: 'center' })));
    if (d.icon) out.push(orn(d.icon, fitSquare(inset(main === tr ? tl : tr, 0.25))));
    return out;
  },
  (p) => `${p.dir}-${p.mask}-${p.tx}`);

// Banner + portrait + text block.
fam(2, 'banner', 'collage', 'Banner & Portrait',
  cross([{ ph: 'left' }, { ph: 'right' }], [{ b: 0.36 }, { b: 0.44 }], [{ g: 0.1, m: 0.2 }, { g: 0, m: 0 }]),
  (c, d, p) => {
    const A = p.m ? inset(card(c), p.m) : card(c);
    const [top, rest] = split(A, c.L ? 'x' : 'y', [p.b, 1 - p.b], p.g);
    const [l, r] = split(rest, c.L ? 'y' : 'x', [1, 1], p.g);
    const [pp, tt] = p.ph === 'left' ? [l, r] : [r, l];
    return [photo(0, top), photo(1, pp), ...Z(c, tt, p.m ? 'plain' : 'surface', fitStack(inset(tt, 0.2), prefs(d, 'tile', p.k)), so(d))];
  },
  (p) => `${p.ph}-${Math.round(p.b * 100)}${p.m ? '-framed' : '-flush'}`);

// Diptych with centre badge.
fam(2, 'diptych', 'framed', 'Diptych Badge',
  cross([{ axis: 'long' }, { axis: 'short' }], [{ badge: 'ellipse' }, { badge: 'plaque' }], [{ m: 0.25 }, { m: 0.4 }]),
  (c, d, p) => {
    const A = inset(card(c), p.m);
    const ax = (p.axis === 'long') === c.P ? 'y' : 'x';
    const [a, b] = split(A, ax, [1, 1], 0.12);
    const out = [photo(0, a), photo(1, b)];
    const s = Math.min(A.w, A.h) * 0.42;
    const br = p.badge === 'ellipse' ? sq(A.x + A.w / 2, A.y + A.h / 2, s) : box(A.x + A.w / 2, A.y + A.h / 2, Math.min(A.w * 0.7, 3), s * 0.62);
    out.push(...Z(c, br, p.badge, fitStack(inset(br, 0.12), prefs(d, 'badge', p.k)), so(d)));
    out.push(...frame(d, inset(card(c), p.m * 0.45)));
    return out;
  },
  (p) => `${p.axis}-${p.badge}-${Math.round(p.m * 100)}`);

// Vertical filmstrip duo.
fam(2, 'filmstrip', 'collage', 'Filmstrip Duo',
  cross([{ at: 'left' }, { at: 'right' }, { at: 'center' }], [{ dark: true }, { dark: false }]),
  (c, d, p) => {
    const A = card(c);
    const sw = c.L ? c.W * 0.4 : c.W * 0.46;
    const sx = p.at === 'left' ? c.W * 0.08 : p.at === 'right' ? c.W * 0.92 - sw : (c.W - sw) / 2;
    const strip = c.L ? R(c.W * 0.08, 0, c.W * 0.84, c.H * 0.5) : R(sx, 0, sw, c.H);
    const out = [shape(strip, { fill: p.dark ? '@text' : '@surface' })];
    const inner = inset(strip, strip.w * 0.08, strip.h * 0.05);
    const cells = split(inner, c.L ? 'x' : 'y', [1, 1], 0.12);
    out.push(...photos(cells));
    const trr = c.L ? safe(c, R(c.W * 0.1, c.H * 0.56, c.W * 0.8, c.H * 0.36)) : p.at === 'center' ? null : safe(c, R(p.at === 'left' ? sx + sw + 0.2 : c.W * 0.08, c.H * 0.2, c.W - sw - 0.2 - c.W * 0.16, c.H * 0.6));
    if (trr) out.push(...Z(c, trr, 'plain', fitStack(trr, prefs(d, 'band', p.k)), so(d)));
    else {
      const br = box(c.W / 2, c.H / 2, sw * 0.86, c.H * 0.16);
      out.push(...Z(c, br, 'plaque', fitStack(br, prefs(d, 'badge', p.k)), so(d)));
    }
    return out;
  },
  (p) => `${p.at}-${p.dark ? 'dark' : 'light'}`);

/* ---------------- 3 photos ---------------- */
const T3 = {
  heroTop: { name: 'hero-top', tree: ['y', [3, 2], ['p', ['x', [1, 1], ['p', 'p']]]] },
  heroTopAsym: { name: 'hero-top-asym', tree: ['y', [3, 2], ['p', ['x', [3, 2], ['p', 'p']]]] },
  heroBottom: { name: 'hero-bottom', tree: ['y', [2, 3], [['x', [1, 1], ['p', 'p']], 'p']] },
  tallLeft: { name: 'tall-left', tree: ['x', [3, 2], ['p', ['y', [1, 1], ['p', 'p']]]] },
  tallRight: { name: 'tall-right', tree: ['x', [2, 3], [['y', [1, 1], ['p', 'p']], 'p']] },
  rows: { name: 'rows', tree: ['y', [1, 1, 1], ['p', 'p', 'p']] },
  cols: { name: 'cols', tree: ['x', [1, 1, 1], ['p', 'p', 'p']] },
  wideMid: { name: 'wide-middle', tree: ['y', [1, 1.6, 1], ['p', 'p', 'p']] },
};
mosaicFam(3, 'trio', 'full-bleed', 'Trio', [T3.heroTop, T3.heroBottom, T3.tallLeft, T3.rows], [FLUSH, THIN], TEXT_OVER);
mosaicFam(3, 'trio-framed', 'framed', 'Framed Trio', [T3.heroTop, T3.heroTopAsym, T3.tallRight, T3.cols, T3.wideMid], [FRAMED, MAT, KEYLINE, ROUND, WIDE], TEXT_BANDS.slice(0, 2));
mosaicFam(3, 'trio-split', 'split', 'Trio Split', [T3.rows, T3.heroTop, T3.tallLeft], [THIN, FLUSH],
  [{ text: { mode: 'band', side: 'right', frac: 0.4, backing: 'surface' } }, { text: { mode: 'band', side: 'bottom', frac: 0.36, backing: 'invert' } }]);
mosaicFam(3, 'trio-tile', 'collage', 'Trio + Note',
  [{ name: 'tile-br', tree: ['y', [1, 1], ['p', ['x', [1, 1], ['p', ['y', [1, 1], ['p', 't']]]]]] },
    { name: 'tile-mid', tree: ['y', [1.3, 0.8, 1.3], ['p', 't', ['x', [1, 1], ['p', 'p']]]] },
    { name: 'tile-tl', tree: ['x', [1, 1.4], [['y', [1, 1.3], ['t', 'p']], ['y', [1.3, 1], ['p', 'p']]]] }],
  [THIN, FRAMED, ROUND], [{ text: { mode: 'tile' } }, { text: { mode: 'tile', backing: 'invert' } }]);
mosaicFam(3, 'trio-cutout', 'cutout', 'Cut-out Trio',
  [{ name: 'row', tree: ['x', [1, 1, 1], ['p', 'p', 'p']] }, { name: 'stack', tree: ['y', [1, 1, 1], ['p', 'p', 'p']] }],
  [{ m: 0.25, g: 0.14, mask: 'circle', name: 'circles' }, { m: 0.25, g: 0.14, mask: 'arch', name: 'arches' }, { m: 0.25, g: 0.14, mask: 'stamp', name: 'stamps' }, { m: 0.25, g: 0.14, mask: 'scallop', name: 'scallops' }, { m: 0.25, g: 0.14, mask: 'ellipse', name: 'ovals' }],
  [{ text: { mode: 'band', side: 'bottom', frac: 0.34, keep: true } }, { text: { mode: 'band', side: 'top', frac: 0.32, keep: true } }], { affinity: ['mask'] });

// Arched centre hero flanked by two panels.
fam(3, 'arch-center', 'cutout', 'Arched Center',
  cross([{ mask: 'arch' }, { mask: 'ellipse' }, { mask: 'rounded' }], [{ tx: 'bottom' }, { tx: 'top' }], [{ fl: 'rect' }, { fl: 'circle' }]),
  (c, d, p) => {
    const b = cardBand(c, p.tx, 0.28, true);
    const A = inset(b.main, c.u * 0.08);
    const [l, mid, r] = split(A, 'x', [1, 1.7, 1], 0.15);
    const out = [photo(0, mid, maskOpts(p.mask, 0.3))];
    const side = (rr) => (p.fl === 'circle' ? fitSquare(inset(rr, 0, rr.h * 0.18)) : inset(rr, 0, rr.h * 0.14));
    out.push(photo(1, side(l), p.fl === 'circle' ? { mask: 'circle' } : {}), photo(2, side(r), p.fl === 'circle' ? { mask: 'circle' } : {}));
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.mask}-${p.tx}-${p.fl}`);

// Full-bleed hero + two floating insets.
fam(3, 'hero-insets', 'full-bleed', 'Hero + Two Insets',
  cross([{ st: 'polaroid' }, { st: 'circle' }, { st: 'mat' }], [{ at: 'bottom' }, { at: 'top' }, { at: 'side' }]),
  (c, d, p) => {
    const out = [photo(0, card(c))];
    const s = c.u * 0.32;
    const w = p.st === 'circle' ? s : p.st === 'polaroid' ? s * 0.84 : s * 1.15;
    const mx = c.u * 0.08;
    let rs;
    if (p.at === 'side') rs = [R(c.W - mx - w, c.H * 0.1, w, s), R(c.W - mx - w, c.H * 0.1 + s + 0.15, w, s)];
    else {
      const y = p.at === 'bottom' ? c.H - c.H * 0.06 - s : c.H * 0.06;
      rs = [R(c.W - mx - w * 2 - 0.15, y, w, s), R(c.W - mx - w, y, w, s)];
    }
    rs.forEach((r, i) => out.push(photo(i + 1, r, p.st === 'circle' ? { mask: 'circle', shadow: true } : { frameStyle: p.st, shadow: true, rotation: p.st === 'polaroid' ? (i ? 4 : -3) : 0 })));
    const tSide = p.at === 'top' ? 'bottom' : p.at === 'bottom' ? 'top' : 'left';
    const f = tSide === 'left' ? (c.P ? 0.6 : 0.5) : 0.34;
    const sr = tSide === 'bottom' ? R(0, c.H * (1 - f), c.W, c.H * f) : tSide === 'top' ? R(0, 0, c.W, c.H * f) : R(0, 0, c.W * f, c.H);
    const trr = tSide === 'bottom' ? insetSides(sr, 0, sr.h * 0.3, 0, 0) : tSide === 'top' ? insetSides(sr, 0, 0, 0, sr.h * 0.3) : insetSides(sr, 0, sr.h * 0.35, sr.w * 0.2, 0);
    const avoid = tSide === 'left' ? trr : trr;
    out.push(...Z(c, R(avoid.x, avoid.y, Math.min(avoid.w, c.W - mx * 2 - (p.at === 'side' ? w + 0.2 : 0)), avoid.h), `scrim-${tSide}`, fitStack(inset(avoid, 0.2), prefs(d, 'overlay', p.k)), so(d, { scrimRect: sr, align: tSide === 'left' ? 'left' : 'center' })));
    return out;
  },
  (p) => `${p.st}-${p.at}`);

// Three tilted scrapbook polaroids.
fam(3, 'scrap', 'collage', 'Scrapbook Trio',
  cross([{ lay: 'fan' }, { lay: 'cascade' }, { lay: 'triangle' }], [{ tx: 'bottom' }, { tx: 'top' }], [{ sc: true }, { sc: false }]),
  (c, d, p) => {
    const b = cardBand(c, p.tx, 0.26);
    const A = inset(b.main, c.u * 0.1);
    const out = [];
    if (p.sc && d.scatter) out.push(orn(d.scatter, b.main, { opacity: 0.22 }));
    const s = Math.min(A.w, A.h) * 0.52;
    const pos = p.lay === 'fan' ? [[0.27, 0.55, -8], [0.5, 0.45, 0], [0.73, 0.55, 8]] : p.lay === 'cascade' ? [[0.36, 0.3, -5], [0.65, 0.5, 4], [0.43, 0.72, -3]] : [[0.5, 0.3, 3], [0.28, 0.7, -6], [0.72, 0.7, 6]];
    pos.forEach(([fx, fy, r], i) => out.push(photo(i === 1 && p.lay === 'fan' ? 0 : i === 0 && p.lay === 'fan' ? 1 : i, box(A.x + A.w * fx, A.y + A.h * fy, s * 0.84, s), { frameStyle: 'polaroid', shadow: true, rotation: r })));
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.lay}-${p.tx}${p.sc ? '-confetti' : ''}`);

/* ---------------- 4 photos ---------------- */
const T4 = {
  grid: { name: 'grid', tree: ['y', [1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']]]] },
  heroStripB: { name: 'hero-strip', tree: ['y', [2.2, 1], ['p', ['x', [1, 1, 1], ['p', 'p', 'p']]]] },
  heroStripT: { name: 'strip-hero', tree: ['y', [1, 2.2], [['x', [1, 1, 1], ['p', 'p', 'p']], 'p']] },
  tallHero: { name: 'tall-hero', tree: ['x', [1.7, 1], ['p', ['y', [1, 1, 1], ['p', 'p', 'p']]]] },
  tallHeroR: { name: 'tall-hero-r', tree: ['x', [1, 1.7], [['y', [1, 1, 1], ['p', 'p', 'p']], 'p']] },
  brick: { name: 'brick', tree: ['y', [1, 1], [['x', [1.5, 1], ['p', 'p']], ['x', [1, 1.5], ['p', 'p']]]] },
  masonry: { name: 'masonry', tree: ['x', [1, 1], [['y', [1.5, 1], ['p', 'p']], ['y', [1, 1.5], ['p', 'p']]]] },
  rows: { name: 'rows', tree: ['y', [1, 1, 1, 1], ['p', 'p', 'p', 'p']] },
  mixed: { name: 'mixed', tree: ['y', [1.3, 1], [['x', [1, 1], ['p', 'p']], ['x', [2, 1], ['p', 'p']]]] },
};
mosaicFam(4, 'quad', 'full-bleed', 'Quad', [T4.grid, T4.heroStripB, T4.brick, T4.tallHero], [FLUSH, THIN], TEXT_OVER);
mosaicFam(4, 'quad-framed', 'framed', 'Framed Quad', [T4.grid, T4.heroStripT, T4.masonry, T4.mixed, T4.tallHeroR], [FRAMED, MAT, KEYLINE, ROUND, WIDE], TEXT_BANDS.slice(0, 2));
mosaicFam(4, 'quad-split', 'split', 'Quad Split', [T4.grid, T4.rows, T4.heroStripB], [THIN, FLUSH],
  [{ text: { mode: 'band', side: 'right', frac: 0.38, backing: 'surface' } }, { text: { mode: 'band', side: 'bottom', frac: 0.32, backing: 'invert' } }]);
mosaicFam(4, 'quad-cutout', 'cutout', 'Cut-out Gallery',
  [T4.grid],
  [{ m: 0.25, g: 0.14, mask: 'circle', name: 'circles' }, { m: 0.25, g: 0.14, mask: 'arch', name: 'arches' }, { m: 0.25, g: 0.14, mask: 'stamp', name: 'stamps' }, { m: 0.25, g: 0.14, mask: 'scallop', name: 'scallops' }, { m: 0.25, g: 0.14, mask: 'ellipse', name: 'ovals' }, { m: 0.25, g: 0.14, mask: 'heart', name: 'hearts' }],
  [{ text: { mode: 'band', side: 'bottom', frac: 0.3 } }, { text: { mode: 'band', side: 'top', frac: 0.28 } }], { affinity: ['mask'] });
mosaicFam(4, 'quad-tile', 'collage', 'Quad + Note',
  [{ name: 'tile-center', tree: ['y', [1, 0.8, 1], [['x', [1, 1], ['p', 'p']], 't', ['x', [1, 1], ['p', 'p']]]] },
    { name: 'tile-corner', tree: ['y', [1.2, 1], [['x', [1.4, 1], ['p', ['y', [1, 1], ['p', 'p']]]], ['x', [1, 1], ['p', 't']]]] }],
  [THIN, FRAMED, ROUND], [{ text: { mode: 'tile' } }, { text: { mode: 'tile', backing: 'invert' } }]);

// 2-left / text column / 2-right.
fam(4, 'columns', 'split', 'Center Column',
  cross([{ mid: 0.9 }, { mid: 1.2 }], [{ m: 0 }, { m: 0.2 }], [{ bk: 'plain' }, { bk: 'surface' }]),
  (c, d, p) => {
    const A = p.m ? inset(card(c), p.m) : card(c);
    const ax = c.P ? 'y' : 'x';
    const [a, mid, b] = split(A, ax, [1, p.mid, 1], p.m ? 0.12 : 0);
    const o = ax === 'y' ? 'x' : 'y';
    const out = photos([...split(a, o, [1, 1], p.m ? 0.12 : 0.04), ...split(b, o, [1, 1], p.m ? 0.12 : 0.04)]);
    out.push(...Z(c, mid, p.bk, fitStack(inset(mid, 0.15), prefs(d, 'tile', p.k)), so(d)));
    return out;
  },
  (p) => `${Math.round(p.mid * 100)}-${p.m ? 'framed' : 'flush'}-${p.bk}`);

// Four-photo polaroid scatter.
fam(4, 'scatter', 'collage', 'Polaroid Scatter',
  cross([{ lay: 'square' }, { lay: 'zigzag' }, { lay: 'pile' }], [{ tx: 'bottom' }, { tx: 'top' }, { tx: 'center' }]),
  (c, d, p) => {
    const out = [];
    const b = p.tx === 'center' ? null : cardBand(c, p.tx, 0.24);
    const A = inset(b ? b.main : card(c), c.u * 0.08);
    if (d.scatter) out.push(orn(d.scatter, b ? b.main : card(c), { opacity: 0.2 }));
    const s = Math.min(A.w, A.h) * (p.tx === 'center' ? 0.42 : 0.46);
    const pos = p.lay === 'square' ? [[0.27, 0.27, -5], [0.73, 0.27, 4], [0.27, 0.73, 3], [0.73, 0.73, -6]] : p.lay === 'zigzag' ? [[0.25, 0.22, -6], [0.72, 0.38, 5], [0.28, 0.62, 4], [0.75, 0.8, -4]] : [[0.32, 0.3, -9], [0.68, 0.32, 7], [0.36, 0.7, 5], [0.66, 0.68, -5]];
    pos.forEach(([fx, fy, r], i) => out.push(photo(i, box(A.x + A.w * fx, A.y + A.h * fy, s * 0.84, s), { frameStyle: 'polaroid', shadow: true, rotation: r })));
    if (b) out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    else {
      const br = box(c.W / 2, c.H / 2, Math.min(c.W * 0.62, 3.2), c.H * (c.L ? 0.3 : 0.2));
      out.push(...Z(c, br, 'plaque', fitStack(br, prefs(d, 'badge', p.k)), so(d)));
    }
    return out;
  },
  (p) => `${p.lay}-${p.tx}`);

// Full-bleed hero with three floating detail cards.
fam(4, 'hero-cards', 'full-bleed', 'Hero + Cards',
  cross([{ at: 'bottom' }, { at: 'top' }, { at: 'side' }], [{ st: 'mat' }, { st: 'polaroid' }, { st: 'rounded' }]),
  (c, d, p) => {
    const out = [photo(0, card(c), { focusArea: p.at === 'bottom' ? { x: 0, y: 0, w: 1, h: 0.62 } : p.at === 'top' ? { x: 0, y: 0.38, w: 1, h: 0.62 } : { x: 0, y: 0, w: 0.65, h: 1 } })];
    const vertical = p.at === 'side';
    const A = vertical ? R(c.W * 0.74, c.H * 0.06, c.W * 0.2, c.H * 0.88) : R(c.W * 0.06, p.at === 'bottom' ? c.H * 0.74 : c.H * 0.06, c.W * 0.88, c.H * 0.2);
    const cells = split(A, vertical ? 'y' : 'x', [1, 1, 1], 0.12).map((r) => fitAspect(r, p.st === 'polaroid' ? 0.84 : 1.1));
    cells.forEach((r, i) => out.push(photo(i + 1, r, p.st === 'rounded' ? { mask: 'rounded', radius: 0.1, shadow: true } : { frameStyle: p.st, shadow: true, rotation: p.st === 'polaroid' ? [-4, 2, 5][i] : 0 })));
    const tSide = p.at === 'bottom' ? 'top' : p.at === 'top' ? 'bottom' : 'left';
    const f = tSide === 'left' ? 0.6 : 0.32;
    const sr = tSide === 'bottom' ? R(0, c.H * (1 - f), c.W, c.H * f) : tSide === 'top' ? R(0, 0, c.W, c.H * f) : R(0, 0, c.W * f, c.H);
    const trr = tSide === 'bottom' ? insetSides(sr, 0, sr.h * 0.3, 0, 0) : tSide === 'top' ? insetSides(sr, 0, 0, 0, sr.h * 0.3) : insetSides(sr, 0, sr.h * 0.3, sr.w * 0.15, 0);
    out.push(...Z(c, trr, `scrim-${tSide}`, fitStack(inset(trr, 0.2), prefs(d, 'overlay', p.k)), so(d, { scrimRect: sr, align: tSide === 'left' ? 'left' : 'center' })));
    return out;
  },
  (p) => `${p.st}-${p.at}`);

// Magazine cover quad.
fam(4, 'magazine', 'collage', 'Magazine Quad',
  cross([{ v: 'cover' }, { v: 'column' }, { v: 'corner' }], [{ al: 'left' }, { al: 'right' }]),
  (c, d, p) => {
    const out = [];
    const left = p.al === 'left';
    if (p.v === 'cover') {
      const [hero, strip] = split(card(c), c.L ? 'x' : 'y', [3, 1], 0.06);
      out.push(photo(0, hero), ...photos(split(strip, c.L ? 'y' : 'x', [1, 1, 1], 0.06)).map((e) => ({ ...e, slot: e.slot + 1 })));
      const tr0 = c.L ? R(hero.x, hero.y, hero.w * 0.6, hero.h * 0.5) : R(hero.x, hero.y, hero.w, hero.h * 0.4);
      const trr = left ? tr0 : R(hero.x + hero.w - tr0.w, tr0.y, tr0.w, tr0.h);
      out.push(...Z(c, insetSides(trr, 0, 0, 0, trr.h * 0.2), 'scrim-top', fitStack(inset(trr, 0.25), ['editorial', 'minimal', 'headline']), so(d, { scrimRect: c.L ? R(hero.x, 0, hero.w, hero.h * 0.55) : R(0, 0, c.W, hero.h * 0.45), align: p.al })));
    } else if (p.v === 'column') {
      const [col, rest] = split(card(c), 'x', left ? [0.38, 0.62] : [0.62, 0.38]);
      const [tc, ph] = left ? [col, rest] : [rest, col];
      const rows = split(ph, 'y', [1.6, 1, 1], 0.06);
      out.push(photo(0, rows[0]), photo(1, rows[1]), photo(2, rows[2]));
      const [tz, small] = split(tc, 'y', [1.4, 1]);
      out.push(...Z(c, tz, 'plain', fitStack(inset(tz, 0.22), ['editorial', 'classic', 'minimal']), so(d, { align: p.al })));
      out.push(photo(3, inset(small, 0.22, 0.1), { mask: 'rounded', radius: 0.08 }));
    } else {
      const A = card(c);
      const [top, bottom] = split(A, c.L ? 'x' : 'y', [1, 1], 0.06);
      const [tl, tr2] = split(top, c.L ? 'y' : 'x', left ? [1, 1.6] : [1.6, 1], 0.06);
      const [bl, br] = split(bottom, c.L ? 'y' : 'x', left ? [1.6, 1] : [1, 1.6], 0.06);
      const textCell = left ? tl : tr2;
      out.push(...photos([left ? tr2 : tl, bl, br]));
      out.push(photo(3, fitSquare(inset(textCell, Math.min(textCell.w, textCell.h) * 0.14)), { mask: 'circle' }));
      // Greeting across the seam on a plaque.
      const pr = box(A.x + A.w / 2, A.y + A.h / 2, Math.min(A.w * 0.7, 3.2), c.H * (c.L ? 0.26 : 0.17));
      out.push(...Z(c, pr, 'plaque', fitStack(pr, prefs(d, 'badge', p.k)), so(d)));
    }
    return out;
  },
  (p) => `${p.v}-${p.al}`);

/* ---------------- 5 photos ---------------- */
const T5 = {
  heroGrid: { name: 'hero-grid', tree: ['y', [1.3, 1], ['p', ['y', [1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']]]]]] },
  gridHero: { name: 'grid-hero', tree: ['y', [1, 1.3], [['y', [1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']]]], 'p']] },
  twoThree: { name: '2-3', tree: ['y', [1.2, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1, 1], ['p', 'p', 'p']]]] },
  threeTwo: { name: '3-2', tree: ['y', [1, 1.2], [['x', [1, 1, 1], ['p', 'p', 'p']], ['x', [1, 1], ['p', 'p']]]] },
  centerHero: { name: 'center-hero', tree: ['x', [1, 1.8, 1], [['y', [1, 1], ['p', 'p']], 'p', ['y', [1, 1], ['p', 'p']]]] },
  sideHero: { name: 'side-hero', tree: ['x', [1.3, 1], ['p', ['y', [1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']]]]]] },
  sideHeroR: { name: 'side-hero-r', tree: ['x', [1, 1.3], [['y', [1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']]]], 'p']] },
  bento1: { name: 'bento-a', tree: ['y', [1.4, 1], [['x', [1.6, 1], ['p', ['y', [1, 1], ['p', 'p']]]], ['x', [1, 1.5], ['p', 'p']]]] },
  bento2: { name: 'bento-b', tree: ['x', [1, 1.5], [['y', [1, 1.6], ['p', 'p']], ['y', [1.6, 1], ['p', ['x', [1, 1], ['p', 'p']]]]]] },
  bento3: { name: 'bento-c', tree: ['y', [1, 1.6, 1], [['x', [1, 1], ['p', 'p']], 'p', ['x', [1.5, 1], ['p', 'p']]]] },
};
mosaicFam(5, 'five', 'full-bleed', 'Five', [T5.heroGrid, T5.twoThree, T5.centerHero, T5.bento1], [FLUSH, THIN], TEXT_OVER);
mosaicFam(5, 'five-framed', 'framed', 'Framed Five', [T5.gridHero, T5.threeTwo, T5.sideHero, T5.bento2, T5.heroGrid], [FRAMED, MAT, KEYLINE, ROUND, WIDE], TEXT_BANDS.slice(0, 2));
mosaicFam(5, 'five-split', 'split', 'Five Split', [T5.twoThree, T5.sideHeroR, T5.bento3], [THIN, FLUSH],
  [{ text: { mode: 'band', side: 'right', frac: 0.36, backing: 'surface' } }, { text: { mode: 'band', side: 'bottom', frac: 0.3, backing: 'invert' } }]);
mosaicFam(5, 'five-tile', 'collage', 'Masonry + Note',
  [{ name: 'six-cell', tree: ['y', [1, 1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['t', 'p']], ['x', [1, 1], ['p', 'p']]]] },
    { name: 'stagger-cell', tree: ['x', [1, 1], [['y', [1.4, 1, 1], ['p', 't', 'p']], ['y', [1, 1, 1.4], ['p', 'p', 'p']]]] },
    { name: 'brick-cell', tree: ['y', [1, 1, 1], [['x', [1.5, 1], ['p', 'p']], ['x', [1, 1.5], ['t', 'p']], ['x', [1.5, 1], ['p', 'p']]]] }],
  [THIN, FRAMED, ROUND], [{ text: { mode: 'tile' } }, { text: { mode: 'tile', backing: 'invert' } }]);
mosaicFam(5, 'five-cutout', 'cutout', 'Cut-out Five',
  [{ name: 'two-three', tree: ['y', [1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1, 1], ['p', 'p', 'p']]]] }, { name: 'three-two', tree: ['y', [1, 1], [['x', [1, 1, 1], ['p', 'p', 'p']], ['x', [1, 1], ['p', 'p']]]] }],
  [{ m: 0.22, g: 0.12, mask: 'circle', name: 'circles' }, { m: 0.22, g: 0.12, mask: 'arch', name: 'arches' }, { m: 0.22, g: 0.12, mask: 'stamp', name: 'stamps' }, { m: 0.22, g: 0.12, mask: 'rounded', radius: 0.2, name: 'pills' }],
  [{ text: { mode: 'band', side: 'bottom', frac: 0.28 } }, { text: { mode: 'band', side: 'top', frac: 0.26 } }], { affinity: ['mask'] });

// Cross / plus focal photo with four corner insets.
fam(5, 'cross', 'collage', 'Cross Focal',
  cross([{ st: 'rect' }, { st: 'circle' }, { st: 'polaroid' }], [{ tx: 'band' }, { tx: 'badge' }]),
  (c, d, p) => {
    const b = p.tx === 'band' ? cardBand(c, 'bottom', 0.24) : null;
    const A = inset(b ? b.main : card(c), c.u * 0.08);
    const out = [];
    const hs = Math.min(A.w, A.h) * 0.52;
    const hero = box(A.x + A.w / 2, A.y + A.h / 2, c.L ? hs * 1.25 : hs, c.L ? hs : hs * 1.2);
    const s = Math.min(A.w, A.h) * 0.3;
    const cornersR = [R(A.x, A.y, s, s), R(A.x + A.w - s, A.y, s, s), R(A.x, A.y + A.h - s, s, s), R(A.x + A.w - s, A.y + A.h - s, s, s)];
    cornersR.forEach((r, i) => out.push(photo(i + 1, p.st === 'polaroid' ? fitAspect(r, 0.84) : r, p.st === 'circle' ? { mask: 'circle' } : p.st === 'polaroid' ? { frameStyle: 'polaroid', rotation: [-5, 5, 4, -4][i], shadow: true } : {})));
    out.push(photo(0, hero, { shadow: true, frameStyle: p.st === 'polaroid' ? 'mat' : 'none' }));
    if (b) out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    else {
      const br = box(c.W / 2, hero.y + hero.h - 0.2, Math.min(hero.w * 1.1, c.W * 0.7), c.H * (c.L ? 0.22 : 0.14));
      out.push(...Z(c, br, 'plaque', fitStack(br, prefs(d, 'badge', p.k)), so(d)));
    }
    return out;
  },
  (p) => `${p.st}-${p.tx}`);

// Five-photo scrapbook cluster.
fam(5, 'scrap5', 'collage', 'Scrapbook Five',
  cross([{ lay: 'cluster' }, { lay: 'diagonal' }], [{ tx: 'bottom' }, { tx: 'top' }], [{ sc: true }, { sc: false }]),
  (c, d, p) => {
    const b = cardBand(c, p.tx, 0.24);
    const A = inset(b.main, c.u * 0.08);
    const out = [];
    if (p.sc && d.scatter) out.push(orn(d.scatter, b.main, { opacity: 0.2 }));
    const s = Math.min(A.w, A.h) * 0.4;
    const pos = p.lay === 'cluster' ? [[0.5, 0.5, 2, 1.25], [0.22, 0.24, -7, 1], [0.78, 0.24, 6, 1], [0.22, 0.78, 5, 1], [0.78, 0.78, -5, 1]] : [[0.5, 0.5, -2, 1.2], [0.2, 0.18, -8, 1], [0.38, 0.32, 5, 0.9], [0.66, 0.7, -4, 0.9], [0.82, 0.84, 7, 1]];
    // Hero (slot 0) drawn last so it sits on top.
    const order = [1, 2, 3, 4, 0];
    for (const i of order) {
      const [fx, fy, r, k] = pos[i];
      out.push(photo(i, box(A.x + A.w * fx, A.y + A.h * fy, s * 0.84 * k, s * k), { frameStyle: 'polaroid', shadow: true, rotation: r }));
    }
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.lay}-${p.tx}${p.sc ? '-confetti' : ''}`);

// Full-bleed hero + four floating filmstrip frames.
fam(5, 'hero-film', 'full-bleed', 'Hero + Film Frames',
  cross([{ at: 'bottom' }, { at: 'top' }, { at: 'side' }], [{ st: 'mat' }, { st: 'rounded' }]),
  (c, d, p) => {
    const out = [photo(0, card(c))];
    const vertical = p.at === 'side';
    const A = vertical ? R(c.W * 0.76, c.H * 0.06, c.W * 0.18, c.H * 0.88) : R(c.W * 0.05, p.at === 'bottom' ? c.H * 0.77 : c.H * 0.05, c.W * 0.9, c.H * 0.18);
    out.push(shape(A, { fill: '@text', opacity: 0.85, radius: 0.04 }));
    split(inset(A, 0.06), vertical ? 'y' : 'x', [1, 1, 1, 1], 0.06).forEach((r, i) => out.push(photo(i + 1, r, p.st === 'rounded' ? { mask: 'rounded', radius: 0.06 } : { frameStyle: 'mat' })));
    const tSide = p.at === 'bottom' ? 'top' : p.at === 'top' ? 'bottom' : 'left';
    const f = tSide === 'left' ? 0.62 : 0.32;
    const sr = tSide === 'bottom' ? R(0, c.H * (1 - f), c.W, c.H * f) : tSide === 'top' ? R(0, 0, c.W, c.H * f) : R(0, 0, c.W * f, c.H);
    const trr = tSide === 'bottom' ? insetSides(sr, 0, sr.h * 0.3, 0, 0) : tSide === 'top' ? insetSides(sr, 0, 0, 0, sr.h * 0.3) : insetSides(sr, 0, sr.h * 0.3, sr.w * 0.15, 0);
    out.push(...Z(c, trr, `scrim-${tSide}`, fitStack(inset(trr, 0.2), prefs(d, 'overlay', p.k)), so(d, { scrimRect: sr, align: tSide === 'left' ? 'left' : 'center' })));
    return out;
  },
  (p) => `${p.st}-${p.at}`);

/* ---------------- 6 photos ---------------- */
const T6 = {
  g23: { name: '2x3', tree: ['y', [1, 1, 1], [['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']], ['x', [1, 1], ['p', 'p']]]] },
  g32: { name: '3x2', tree: ['y', [1, 1], [['x', [1, 1, 1], ['p', 'p', 'p']], ['x', [1, 1, 1], ['p', 'p', 'p']]]] },
  heroL: { name: 'hero-l', tree: ['y', [2, 1], [['x', [2, 1], ['p', ['y', [1, 1], ['p', 'p']]]], ['x', [1, 1, 1], ['p', 'p', 'p']]]] },
  heroLR: { name: 'hero-l-mirror', tree: ['y', [1, 2], [['x', [1, 1, 1], ['p', 'p', 'p']], ['x', [1, 2], [['y', [1, 1], ['p', 'p']], 'p']]]] },
  pano: { name: 'pano', tree: ['y', [1, 1.2, 1], ['p', ['x', [1, 1, 1, 1], ['p', 'p', 'p', 'p']], 'p']] },
  contact: { name: 'contact', tree: ['x', [1, 1], [['y', [1, 1, 1], ['p', 'p', 'p']], ['y', [1, 1, 1], ['p', 'p', 'p']]]] },
  bento: { name: 'bento', tree: ['y', [1.5, 1, 1], [['x', [1.6, 1], ['p', 'p']], ['x', [1, 1, 1], ['p', 'p', 'p']], 'p']] },
  bento2: { name: 'bento-b', tree: ['x', [1.5, 1], [['y', [1.4, 1], ['p', ['x', [1, 1], ['p', 'p']]]], ['y', [1, 1, 1], ['p', 'p', 'p']]]] },
  stripes: { name: 'strips', tree: ['y', [1, 1, 1, 1, 1, 1], ['p', 'p', 'p', 'p', 'p', 'p']] },
};
mosaicFam(6, 'six', 'full-bleed', 'Six', [T6.g23, T6.g32, T6.heroL, T6.bento], [FLUSH, THIN], TEXT_OVER);
mosaicFam(6, 'six-framed', 'framed', 'Framed Six', [T6.g23, T6.g32, T6.heroLR, T6.pano, T6.bento2], [FRAMED, MAT, KEYLINE, ROUND, WIDE], TEXT_BANDS.slice(0, 2));
mosaicFam(6, 'six-split', 'split', 'Six Split', [T6.g23, T6.contact, T6.heroL], [THIN, FLUSH],
  [{ text: { mode: 'band', side: 'right', frac: 0.34, backing: 'surface' } }, { text: { mode: 'band', side: 'bottom', frac: 0.28, backing: 'invert' } }]);
mosaicFam(6, 'six-cutout', 'cutout', 'Cut-out Showcase',
  [T6.g23, T6.g32],
  [{ m: 0.22, g: 0.12, mask: 'circle', name: 'circles' }, { m: 0.22, g: 0.12, mask: 'arch', name: 'arches' }, { m: 0.22, g: 0.12, mask: 'rounded', radius: 0.16, name: 'rounded' }, { m: 0.22, g: 0.12, mask: 'stamp', name: 'stamps' }],
  [{ text: { mode: 'band', side: 'bottom', frac: 0.26 } }, { text: { mode: 'band', side: 'top', frac: 0.24 } }], { affinity: ['mask'] });
mosaicFam(6, 'six-tile', 'collage', 'Six + Note',
  [{ name: 'seven-cell', tree: ['y', [1, 1, 1], [['x', [1, 1, 1], ['p', 'p', 'p']], ['x', [1, 1.8], ['p', 't']], ['x', [1, 1], ['p', 'p']]]] },
    { name: 'ribbon-cell', tree: ['x', [1, 1.3, 1], [['y', [1, 1, 1], ['p', 'p', 'p']], 't', ['y', [1, 1, 1], ['p', 'p', 'p']]]] }],
  [THIN, FRAMED, ROUND], [{ text: { mode: 'tile' } }, { text: { mode: 'tile', backing: 'invert' } }]);

// 3×2 polaroid wall.
fam(6, 'wall', 'collage', 'Polaroid Wall',
  cross([{ tilt: 0 }, { tilt: 1 }], [{ tx: 'bottom' }, { tx: 'top' }], [{ sc: true }, { sc: false }]),
  (c, d, p) => {
    const b = cardBand(c, p.tx, 0.24);
    const A = inset(b.main, c.u * 0.08);
    const out = [];
    if (p.sc && d.scatter) out.push(orn(d.scatter, b.main, { opacity: 0.2 }));
    const cols = c.L ? 3 : 2, rows = c.L ? 2 : 3;
    const tilts = [-4, 3, -2, 5, -5, 2];
    grid(A, cols, rows, 0.14).forEach((r, i) => out.push(photo(i, fitAspect(inset(r, 0.04), 0.84), { frameStyle: 'polaroid', shadow: true, rotation: p.tilt ? tilts[i] : 0 })));
    out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
    return out;
  },
  (p) => `${p.tilt ? 'tilted' : 'neat'}-${p.tx}${p.sc ? '-confetti' : ''}`);

// 3-left / greeting ribbon / 3-right.
fam(6, 'ribbon', 'split', 'Greeting Ribbon',
  cross([{ w: 0.9 }, { w: 1.3 }], [{ bk: 'invert' }, { bk: 'surface' }, { bk: 'plain' }], [{ m: 0 }, { m: 0.2 }]),
  (c, d, p) => {
    const A = p.m ? inset(card(c), p.m) : card(c);
    const ax = c.P ? 'y' : 'x';
    const g = p.m ? 0.1 : 0.04;
    const [a, mid, b] = split(A, ax, [1, p.w, 1], p.m ? 0.12 : 0);
    const o = ax === 'y' ? 'x' : 'y';
    const out = photos([...split(a, o, [1, 1, 1], g), ...split(b, o, [1, 1, 1], g)]);
    out.push(...Z(c, mid, p.bk, fitStack(inset(mid, 0.15), prefs(d, 'tile', p.k)), so(d)));
    return out;
  },
  (p) => `${Math.round(p.w * 100)}-${p.bk}-${p.m ? 'framed' : 'flush'}`);

/* ---------------- shared multi-photo families: typography / letter / postcard ---------------- */

for (const n of [2, 3, 4, 5, 6]) {
  // Type-led: a big greeting with a row of small photos.
  fam(n, `typo${n}`, 'typography', 'Type & Strip',
    cross([{ at: 'bottom' }, { at: 'top' }, { at: 'middle' }], [{ mask: 'rect' }, { mask: 'circle' }, { mask: 'rounded' }]),
    (c, d, p) => {
      const A = safe(c, inset(card(c), 0.1));
      const rows = n > 3 && c.P ? 2 : 1;
      const stripH = Math.min(A.h * (rows === 2 ? 0.4 : 0.28), (A.w / Math.ceil(n / rows)) * rows * 1.1);
      const sy = p.at === 'bottom' ? A.y + A.h - stripH : p.at === 'top' ? A.y : A.y + (A.h - stripH) / 2;
      const strip = R(A.x, sy, A.w, stripH);
      const cells = rows === 2 ? [...split(split(strip, 'y', [1, 1], 0.1)[0], 'x', Array(Math.ceil(n / 2)).fill(1), 0.1), ...split(split(strip, 'y', [1, 1], 0.1)[1], 'x', Array(Math.floor(n / 2)).fill(1), 0.1)] : split(strip, 'x', Array(n).fill(1), 0.1);
      const out = photos(cells.map((r) => (p.mask === 'circle' ? fitSquare(r) : r)), maskOpts(p.mask, 0.1));
      if (p.at === 'middle') {
        const t1 = R(A.x, A.y, A.w, sy - A.y - 0.2), t2 = R(A.x, sy + stripH + 0.2, A.w, A.y + A.h - sy - stripH - 0.2);
        out.push(...Z(c, t1, 'plain', 'headline', so(d)), ...Z(c, t2, 'plain', fitStack(t2, ['signoff', 'kicker'], ['headline']), so(d)));
      } else {
        const tz = p.at === 'bottom' ? R(A.x, A.y, A.w, A.h - stripH - 0.25) : R(A.x, A.y + stripH + 0.25, A.w, A.h - stripH - 0.25);
        out.push(...Z(c, tz, 'plain', fitStack(tz, prefs(d, 'large', p.k)), so(d)));
      }
      return out;
    },
    (p) => `${p.at}-${p.mask}`);

  // Letter with a photo band.
  fam(n, `letter${n}`, 'letter', 'Photo Letter',
    cross([{ at: 'top' }, { at: 'side' }, { at: 'bottom' }], [{ g: 0.08 }, { g: 0 }]),
    (c, d, p) => {
      const A = safe(c, inset(card(c), 0.12));
      const side = p.at === 'side' || (c.L && p.at !== 'bottom');
      const frac = side ? 0.36 : 0.34;
      const [a, b] = split(A, side ? 'x' : 'y', p.at === 'bottom' ? [1 - frac, frac] : [frac, 1 - frac], 0.25);
      const [ph, tz] = p.at === 'bottom' ? [b, a] : [a, b];
      const cols = side ? (n > 3 ? 2 : 1) : n > 3 ? Math.ceil(n / 2) : n;
      const rows = Math.ceil(n / cols);
      const cells = grid(ph, cols, rows, p.g).slice(0, n);
      const out = photos(cells, p.g ? maskOpts('rounded', 0.05) : {});
      out.push(...Z(c, tz, 'plain', fitStack(tz, ['letter', 'letter-short', 'message']), so(d, { align: 'left' })));
      return out;
    },
    (p) => `${p.at}${p.g ? '' : '-flush'}`, { kinds: ['back', 'inside', 'front'] });

  // Postcard with photos and a message side.
  fam(n, `postcard${n}`, 'postcard', 'Postcard',
    cross([{ ph: 'first' }, { ph: 'second' }], [{ r: 0.55 }, { r: 0.64 }], [{ arr: 'grid' }, { arr: 'hero' }, { arr: 'stamps' }]),
    (c, d, p) => {
      const A = card(c);
      const axis = c.P ? 'y' : 'x';
      const parts = split(A, axis, p.ph === 'first' ? [p.r, 1 - p.r] : [1 - p.r, p.r]);
      const [pa, ta] = p.ph === 'first' ? parts : [parts[1], parts[0]];
      const pArea = inset(pa, p.arr === 'stamps' ? 0.26 : 0.18);
      const row = (k) => ['x', Array(k).fill(1), Array(k).fill('p')];
      const grid = n === 2 ? row(2) : n === 3 ? ['x', [1.4, 1], ['p', ['y', [1, 1], ['p', 'p']]]] : n === 4 ? ['y', [1, 1], [row(2), row(2)]] : n === 5 ? ['x', [1.3, 1], ['p', ['y', [1, 1], [row(2), row(2)]]]] : ['y', [1, 1], [row(3), row(3)]];
      // Hero: one big photo with the rest in a strip under it.
      const hero = ['y', [n <= 3 ? 1.5 : 2, 1], ['p', row(n - 1)]];
      const tree = p.arr === 'hero' ? hero : grid;
      const leaves = partition(pArea, tree, p.arr === 'stamps' ? 0.16 : 0.08, needSwap(c, pArea, 5 / 3.5)).map((l) => l.rect);
      const out = photos(leaves, p.arr === 'stamps' ? { mask: 'stamp' } : { frameStyle: 'none' });
      const T = safe(c, inset(ta, 0.2));
      const [msg, addr] = split(T, axis === 'y' ? 'x' : 'y', [0.56, 0.44], 0.2);
      out.push(...Z(c, msg, 'plain', fitStack(msg, ['message', 'classic', 'minimal']), so(d, { align: 'left' })));
      const s = Math.min(addr.w * 0.36, addr.h * 0.4);
      out.push(orn(d.icon, R(addr.x + addr.w - s, addr.y, s, s)));
      const lines = R(addr.x, addr.y + s + 0.1, addr.w, addr.h - s - 0.1);
      for (let i = 0; i < 3; i++) out.push(rule(R(lines.x, lines.y + (lines.h / 3) * (i + 0.6), lines.w, 0.02), { fill: '@textMuted' }));
      return out;
    },
    (p) => `${p.arr}-${p.ph}-${Math.round(p.r * 100)}`, { kinds: ['front', 'back'] });
}

/* ---------------- 3–6 photo hero + strip variants (more photo geometry) ---------------- */
for (const n of [3, 4, 5, 6]) {
  const k = n - 1;
  fam(n, `hero-strip${n}`, n === 3 ? 'framed' : 'collage', 'Hero & Strip',
    cross([{ side: 'bottom' }, { side: 'top' }, { side: 'left' }, { side: 'right' }], [{ r: 0.72 }, { r: 0.62 }], [{ st: FLUSH }, { st: FRAMED }]),
    (c, d, p) => {
      const b = cardBand(c, 'bottom', 0.24);
      const area = p.st.m ? inset(b.main, p.st.m) : b.main;
      const vertical = p.side === 'left' || p.side === 'right';
      const first = p.side === 'top' || p.side === 'left';
      const ax = vertical ? 'x' : 'y';
      const [a, bb] = split(area, ax, first ? [1 - p.r, p.r] : [p.r, 1 - p.r], p.st.g);
      const [hero, st] = first ? [bb, a] : [a, bb];
      const cells = split(st, vertical ? 'y' : 'x', Array(k).fill(1), p.st.g || 0.04);
      const out = [photo(0, hero), ...cells.map((r, i) => photo(i + 1, r))];
      out.push(...Z(c, b.band, 'plain', fitStack(inset(b.band, 0.2), prefs(d, 'band', p.k)), so(d)));
      return out;
    },
    (p) => `${p.side}-${Math.round(p.r * 100)}-${p.st.name}`);
}

/* ------------------------------------------------------------------------------------------ */

export function familiesFor(n) {
  return FAMILIES[n];
}
