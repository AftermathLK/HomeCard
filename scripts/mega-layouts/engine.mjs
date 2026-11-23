// Layout engine for the mega layout library generator.
//
// Layouts are designed in inches on a reference card per orientation (portrait 5×7, landscape 7×5,
// square 5×5) and converted to the normalised [x, y, w, h] rects that style-pack templates use.
// Working in inches keeps circles round, polaroid borders even and type sizes sensible in every
// orientation; the conversion is the only place that knows about fractions.

export const REF = {
  portrait: { W: 5, H: 7 },
  landscape: { W: 7, H: 5 },
  square: { W: 5, H: 5 },
};
export const ORIENTATIONS = ['portrait', 'landscape', 'square'];

/** Text must stay inside [SAFE .. 1 - SAFE] of the trim box on both axes. */
export const SAFE = 0.06;

export function ctxFor(o) {
  const { W, H } = REF[o];
  return { o, W, H, u: Math.min(W, H), P: o === 'portrait', L: o === 'landscape', S: o === 'square', sx: SAFE * W, sy: SAFE * H };
}

/* ------------------------------ geometry ------------------------------ */

export const R = (x, y, w, h) => ({ x, y, w, h });
export const card = (c) => R(0, 0, c.W, c.H);
export const inset = (r, dx, dy = dx) => R(r.x + dx, r.y + dy, r.w - 2 * dx, r.h - 2 * dy);
export const insetSides = (r, l, t, rr, b) => R(r.x + l, r.y + t, r.w - l - rr, r.h - t - b);
export const center = (r) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2 });
export const sq = (cx, cy, s) => R(cx - s / 2, cy - s / 2, s, s);
export const box = (cx, cy, w, h) => R(cx - w / 2, cy - h / 2, w, h);
/** Largest square centred in r. */
export const fitSquare = (r) => sq(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h));
/** Largest box of aspect (w/h) centred in r. */
export function fitAspect(r, aspect) {
  let w = r.w, h = r.w / aspect;
  if (h > r.h) { h = r.h; w = h * aspect; }
  return box(r.x + r.w / 2, r.y + r.h / 2, w, h);
}

/** Split r along an axis ('x' = side by side, 'y' = stacked) by weights, with gutter g. */
export function split(r, axis, weights, g = 0) {
  const total = weights.reduce((a, b) => a + b, 0);
  const len = (axis === 'x' ? r.w : r.h) - g * (weights.length - 1);
  const out = [];
  let pos = axis === 'x' ? r.x : r.y;
  for (const wt of weights) {
    const l = (len * wt) / total;
    out.push(axis === 'x' ? R(pos, r.y, l, r.h) : R(r.x, pos, r.w, l));
    pos += l + g;
  }
  return out;
}

/** cols × rows grid of equal cells, row-major. */
export function grid(r, cols, rows, g = 0) {
  const out = [];
  for (const row of split(r, 'y', Array(rows).fill(1), g)) out.push(...split(row, 'x', Array(cols).fill(1), g));
  return out;
}

/** Transpose a rect from portrait design space into landscape (swap axes). */
export const tr = (r) => R(r.y, r.x, r.h, r.w);

/**
 * Guillotine partitions. A node is a leaf string ('p' = photo, 't' = text tile) or
 * [axis, weights, children]. In landscape the tree is transposed when `swap` is true, so a layout
 * that stacks along the long edge of a portrait card also stacks along the long edge of a
 * landscape one.
 */
export function partition(area, node, g, swap = false) {
  const out = [];
  const walk = (r, n) => {
    if (typeof n === 'string') return void out.push({ kind: n, rect: r });
    const [axis, weights, kids] = n;
    const ax = swap ? (axis === 'x' ? 'y' : 'x') : axis;
    split(r, ax, weights, g).forEach((rr, i) => walk(rr, kids[i]));
  };
  walk(area, node);
  return out;
}

/** Slot order: the largest photo is slot 0 (the hero), the rest follow in reading order. */
export function assignSlots(rects) {
  const idx = rects.map((r, i) => i);
  const area = (i) => rects[i].w * rects[i].h;
  let hero = 0;
  for (const i of idx) if (area(i) > area(hero) * 1.08) hero = i;
  const rest = idx.filter((i) => i !== hero).sort((a, b) => {
    const ra = rects[a], rb = rects[b];
    const dy = ra.y + ra.h / 2 - (rb.y + rb.h / 2);
    return Math.abs(dy) > 0.15 ? dy : ra.x - rb.x;
  });
  const slots = new Array(rects.length);
  slots[hero] = 0;
  rest.forEach((i, k) => (slots[i] = k + 1));
  return slots;
}

/* ------------------------------ elements ------------------------------ */

export const photo = (slot, r, o = {}) => ({ type: 'photo', slot, ...r, ...o });
export const text = (role, r, o = {}) => ({ type: 'text', role, ...r, ...o });
export const orn = (asset, r, o = {}) => ({ type: 'ornament', asset, ...r, color: '@accent', color2: '@accent2', ...o });
export const shape = (r, o = {}) => ({ type: 'shape', shape: 'rect', fill: '@accent', ...r, ...o });
export const scrim = (r, o = {}) => ({ type: 'scrim', direction: 'to-top', color: '@scrim', strength: 0.55, extent: 0.3, ...r, ...o });
export const rule = (r, o = {}) => shape(r, { shape: 'line', fill: '@accent', ...o });

/** Photos for a list of rects, slots assigned hero-first. */
export function photos(rects, o = {}) {
  const slots = assignSlots(rects);
  return rects.map((r, i) => photo(slots[i], r, typeof o === 'function' ? o(r, slots[i], i) : o));
}

/* ------------------------------ typography ------------------------------ */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Default type size (fraction of the short edge) for a role in a box of h × w inches. */
export function sizeFor(c, role, h, w, max) {
  const u = c.u;
  switch (role) {
    case 'headline': return clamp(Math.min(h * 0.56, w * 0.16) / u, 0.05, max ?? 0.17);
    case 'monogram': return clamp(Math.min(h * 0.78, w * 0.62) / u, 0.1, max ?? 0.34);
    case 'year': return clamp(Math.min(h * 0.6, w * 0.12) / u, 0.026, max ?? 0.05);
    case 'subhead': return clamp(Math.min(h * 0.55, w * 0.07) / u, 0.024, max ?? 0.044);
    case 'names': return clamp(Math.min(h * 0.55, w * 0.075) / u, 0.024, max ?? 0.048);
    case 'message': return clamp(Math.min(h * 0.24, w * 0.05) / u, 0.026, max ?? 0.038);
    case 'body': return clamp(Math.min(h * 0.09, w * 0.045) / u, 0.024, max ?? 0.031);
    case 'small': return clamp(Math.min(h * 0.2, w * 0.05) / u, 0.022, max ?? 0.028);
    default: return 0.036;
  }
}

/**
 * Text stacks: the typographic recipes a text zone can hold. Each item is a role with a relative
 * height (and optional size/font overrides), 'div' (a divider ornament), 'icon' (a centred motif)
 * or 'gap'. `min` is the smallest zone (inches, w × h) the stack reads well in.
 */
export const STACKS = {
  minimal: { min: [1.2, 0.6], items: [{ k: 'headline', w: 3 }, { k: 'names', w: 1 }] },
  headline: { min: [0.9, 0.45], items: [{ k: 'headline', w: 1 }] },
  classic: { min: [1.6, 1.0], items: [{ k: 'headline', w: 3 }, { k: 'names', w: 1 }, { k: 'year', w: 0.8 }] },
  formal: { min: [1.8, 1.6], items: [{ k: 'subhead', w: 0.8 }, { k: 'headline', w: 3 }, { k: 'div', w: 0.55 }, { k: 'names', w: 1 }, { k: 'year', w: 0.8 }] },
  crest: { min: [1.6, 1.8], items: [{ k: 'icon', w: 1.5 }, { k: 'headline', w: 2.6 }, { k: 'names', w: 0.9 }] },
  message: { min: [2.0, 1.9], items: [{ k: 'headline', w: 2.5 }, { k: 'message', w: 2.2 }, { k: 'names', w: 1 }] },
  editorial: { min: [1.8, 1.4], items: [{ k: 'year', w: 0.7 }, { k: 'headline', w: 3.4 }, { k: 'div', w: 0.4 }, { k: 'names', w: 0.9 }] },
  'year-first': { min: [1.6, 1.8], items: [{ k: 'year', w: 2.6, size: 0.2, fontRole: 'display' }, { k: 'headline', w: 1.6 }, { k: 'names', w: 0.9 }] },
  'names-first': { min: [1.8, 1.6], items: [{ k: 'headline', w: 1.1, size: 0.07 }, { k: 'names', w: 2.4, fontRole: 'display', size: 0.1 }, { k: 'div', w: 0.5 }, { k: 'year', w: 0.8 }] },
  monogram: { min: [1.6, 2.3], items: [{ k: 'monogram', w: 3.4 }, { k: 'headline', w: 1.3, size: 0.08 }, { k: 'names', w: 0.9 }, { k: 'year', w: 0.7 }] },
  announce: { min: [2.2, 2.4], items: [{ k: 'subhead', w: 0.8 }, { k: 'headline', w: 2.6 }, { k: 'message', w: 2.0 }, { k: 'names', w: 0.9 }] },
  address: { min: [2.2, 2.4], items: [{ k: 'headline', w: 2.6 }, { k: 'div', w: 0.45 }, { k: 'small', w: 1.9 }, { k: 'names', w: 0.8 }] },
  letter: { min: [2.6, 3.4], items: [{ k: 'headline', w: 1.5 }, { k: 'body', w: 6.5 }, { k: 'names', w: 0.9 }] },
  'letter-short': { min: [2.2, 2.4], items: [{ k: 'headline', w: 1.6 }, { k: 'body', w: 4 }, { k: 'names', w: 0.9 }] },
  // Letter bodies for layouts whose greeting sits in a separate header.
  'letter-body': { min: [2.4, 2.8], items: [{ k: 'body', w: 6.5 }, { k: 'names', w: 0.9 }] },
  body: { min: [2.2, 2.2], items: [{ k: 'body', w: 1 }] },
  // Second text boxes that never repeat the greeting headline.
  kicker: { min: [1.0, 0.3], items: [{ k: 'subhead', w: 1 }] },
  signoff: { min: [1.0, 0.5], items: [{ k: 'names', w: 1.2 }, { k: 'year', w: 0.8 }] },
  note: { min: [1.8, 1.2], items: [{ k: 'message', w: 2.2 }, { k: 'names', w: 1 }] },
  'message-only': { min: [1.6, 0.7], items: [{ k: 'message', w: 1 }] },
  'big-year': { min: [1.8, 2.4], items: [{ k: 'headline', w: 1.3 }, { k: 'year', w: 3.4, size: 0.24, fontRole: 'display' }, { k: 'names', w: 0.9 }] },
  caption: { min: [1.0, 0.5], items: [{ k: 'headline', w: 2 }, { k: 'year', w: 0.9 }] },
  date: { min: [1.8, 1.8], items: [{ k: 'headline', w: 2.2 }, { k: 'names', w: 1.6, fontRole: 'display', size: 0.09 }, { k: 'div', w: 0.45 }, { k: 'year', w: 0.9 }] },
};

/** Text roles a stack prints. */
export const rolesOf = (key) => (STACKS[key]?.items ?? []).map((it) => it.k).filter((k) => k !== 'div' && k !== 'icon' && k !== 'gap');

/**
 * Pick the first stack from prefs that fits in r (falls back to smaller ones). avoid: roles that
 * another text box on the card already prints, so the same words never appear twice.
 */
export function fitStack(r, prefs, avoid = []) {
  const ok = (k) => STACKS[k] && !rolesOf(k).some((role) => avoid.includes(role));
  const fits = (k) => r.w >= STACKS[k].min[0] && r.h >= STACKS[k].min[1];
  for (const k of prefs) if (ok(k) && fits(k)) return k;
  const fallback = ['classic', 'minimal', 'caption', 'headline', 'note', 'signoff', 'message-only', 'kicker'];
  for (const k of fallback) if (ok(k) && fits(k)) return k;
  return fallback.find(ok) ?? 'kicker';
}

/**
 * In a themed pack every greeting carries the occasion's artwork. Stacks without a divider or
 * crest get the occasion divider under the headline when the zone has room for a row; wide, short
 * zones get the crest beside the greeting instead (both sides when centred).
 */
function themedItems(def, r, o) {
  if (!o.themed || !o.div || def.items.some((it) => it.k === 'div' || it.k === 'icon')) return def.items;
  const w = def.items.reduce((a, it) => a + it.w, 0);
  const divW = Math.max(0.35, w * 0.12);
  const rowH = (r.h * divW) / (w + divW);
  if (rowH < 0.12 || r.h < def.min[1] * 0.8 + 0.15) return def.items;
  const at = Math.max(0, def.items.findIndex((it) => it.k === 'headline' || it.fontRole === 'display' || it.k === 'monogram')) + 1;
  return [...def.items.slice(0, at), { k: 'div', w: divW }, ...def.items.slice(at)];
}

function flanked(c, r, key, o) {
  const align = o.align ?? 'center';
  const s = Math.min(r.h * 0.72, r.w * 0.15, 0.95);
  const g = Math.min(0.16, s * 0.25);
  const both = align === 'center';
  const inner = both ? insetSides(r, s + g, 0, s + g, 0) : align === 'left' ? insetSides(r, 0, 0, s + g, 0) : insetSides(r, s + g, 0, 0, 0);
  const out = stackItems(c, inner, key, { ...o, themed: false });
  const cy = r.y + r.h / 2 - s / 2;
  const col = o.ornColor ? { color: o.ornColor } : {};
  if (both || align === 'right') out.push(orn(o.icon, R(r.x, cy, s, s), col));
  if (both || align === 'left') out.push(orn(o.icon, R(r.x + r.w - s, cy, s, s), { ...col, ...(both ? { flipX: true } : {}) }));
  return out;
}

/**
 * Lay out a text stack inside r. Options:
 *   align: 'left' | 'center' | 'right'
 *   ink: colour for every text item (e.g. '@onPhoto' over a scrim, '@background' on a dark panel)
 *   foil: headline (or the stack's display item) in foil
 *   div / icon: ornament assets for 'div' and 'icon' items
 *   ornColor: colour for those ornaments
 */
export function stack(c, r, key, o = {}) {
  const def = STACKS[key] ?? STACKS.classic;
  const items = themedItems(def, r, o);
  if (o.themed && o.icon && items === def.items && !items.some((it) => it.k === 'div' || it.k === 'icon') && r.w >= 2.4 && r.w >= r.h * 2.2) return flanked(c, r, key, o);
  return stackItems(c, r, key, { ...o, items });
}

function stackItems(c, r, key, o) {
  const def = STACKS[key] ?? STACKS.classic;
  const align = o.align ?? 'center';
  const items = o.items ?? def.items;
  const gap = Math.min(0.07, r.h * 0.025);
  const total = items.reduce((a, it) => a + it.w, 0);
  const avail = r.h - gap * (items.length - 1);
  const out = [];
  let y = r.y;
  for (const it of items) {
    const h = (avail * it.w) / total;
    const ir = R(r.x, y, r.w, h);
    if (it.k === 'div') {
      if (o.div) {
        const dw = Math.min(r.w * 0.5, h * (o.divAspect ?? 6), 2.4);
        const dx = align === 'left' ? r.x : align === 'right' ? r.x + r.w - dw : r.x + (r.w - dw) / 2;
        out.push(orn(o.div, R(dx, y, dw, h), o.ornColor ? { color: o.ornColor } : {}));
      }
    } else if (it.k === 'icon') {
      if (o.icon) {
        const s = Math.min(h, r.w * 0.5);
        const ix = align === 'left' ? r.x : align === 'right' ? r.x + r.w - s : r.x + (r.w - s) / 2;
        out.push(orn(o.icon, R(ix, y + (h - s) / 2, s, s), o.ornColor ? { color: o.ornColor } : {}));
      }
    } else if (it.k !== 'gap') {
      const numerals = it.k === 'year' && it.fontRole === 'display';
      const size = numerals ? clamp(Math.min(h * 0.6, r.w * 0.3) / c.u, 0.05, it.size ?? 0.2)
        : it.size ? Math.min(it.size, sizeFor(c, it.k === 'year' || it.fontRole === 'display' ? 'headline' : it.k, h, r.w, it.size)) : sizeFor(c, it.k, h, r.w);
      const t = { size, align };
      if (it.fontRole) t.fontRole = it.fontRole;
      if (o.ink) t.color = o.ink;
      const display = it.k === 'headline' || it.fontRole === 'display' || it.k === 'monogram';
      if (o.foil && display) t.fill = 'foil';
      if (it.k === 'body' || it.k === 'small') t.vAlign = 'top';
      out.push(text(it.k, ir, t));
    }
    y += h + gap;
  }
  return out;
}

/* ------------------------------ text zones ------------------------------ */

/** Clamp a text area into the safe zone. */
export function safe(c, r) {
  const x0 = Math.max(r.x, c.sx), y0 = Math.max(r.y, c.sy);
  const x1 = Math.min(r.x + r.w, c.W - c.sx), y1 = Math.min(r.y + r.h, c.H - c.sy);
  return R(x0, y0, Math.max(0.2, x1 - x0), Math.max(0.2, y1 - y0));
}

/**
 * Put a text stack into a zone with a backing that keeps it readable:
 *   plain   - on the card background
 *   surface - on a @surface panel
 *   invert  - on a dark @text panel, type in @background
 *   plaque  - on a @background card (rounded) floating over a photo
 *   ellipse - on a @background oval floating over a photo
 *   scrim-* - over a photo with a gradient (bottom/top/left/right/center/radial)
 * Returns the elements (backing first).
 */
export function zone(c, r, mode, key0, o = {}) {
  const out = [];
  const pad = o.pad ?? Math.min(0.22, Math.min(r.w, r.h) * 0.1);
  // Year-led occasions (New Year, graduation) lead with big year numerals wherever they fit.
  let key = key0;
  if (o.bigYear) {
    const big = bigYearKey(key0);
    const room = inset(r, pad);
    if (big !== key0 && room.w >= STACKS[big].min[0] && room.h >= STACKS[big].min[1]) key = big;
  }
  const ink = (v) => ({ ...o, ink: v });
  const area = (rr, anchor = 'middle') => compact(c, safe(c, rr), key, anchor);
  switch (mode) {
    case 'plain':
      out.push(...stack(c, area(inset(r, pad)), key, o));
      break;
    case 'surface':
      out.push(shape(r, { fill: '@surface', radius: o.radius ?? 0 }));
      out.push(...stack(c, area(inset(r, pad)), key, o));
      break;
    case 'invert':
      out.push(shape(r, { fill: '@text', radius: o.radius ?? 0 }));
      // Foil may stay on the dark panel; the generator drops it wherever it would not read.
      out.push(...stack(c, area(inset(r, pad)), key, { ...ink('@background'), ornColor: '@background' }));
      break;
    case 'plaque':
      out.push(shape(r, { fill: '@background', opacity: 0.93, radius: o.radius ?? 0.08 }));
      out.push(...stack(c, area(inset(r, pad * 1.1)), key, o));
      break;
    case 'ellipse': {
      out.push(shape(r, { shape: 'ellipse', fill: '@background', opacity: 0.93 }));
      out.push(...stack(c, area(inset(r, r.w * 0.17, r.h * 0.2)), key, o));
      break;
    }
    default: {
      // scrim-bottom | scrim-top | scrim-left | scrim-right | scrim-center | scrim-radial
      // Type over a photo is always the plain on-photo ink: foil does not read on a busy picture.
      const where = mode.slice(6);
      const dir = { bottom: 'to-top', top: 'to-bottom', left: 'to-right', right: 'to-left', center: 'solid', radial: 'radial' }[where];
      const sr = o.scrimRect ?? r;
      out.push(scrim(sr, { direction: dir, strength: where === 'center' ? 0.42 : where === 'radial' ? 0.5 : 0.6, extent: where === 'radial' ? 0.45 : 0.4 }));
      const anchor = where === 'top' ? 'top' : where === 'center' || where === 'radial' ? 'middle' : 'bottom';
      out.push(...stack(c, area(inset(r, pad), anchor), key, { ...ink('@onPhoto'), foil: false, ornColor: '@onPhoto' }));
    }
  }
  return out;
}

/**
 * The same stack led by the year as display numerals (sizeRel up to 0.22, the {{year}} token).
 * Letters, small badges and stacks that already lead with the year are left as they are.
 */
export function bigYearKey(key) {
  const def = STACKS[key];
  if (!def || key.endsWith('+year') || def.items.length < 2) return key;
  if (def.items.some((it) => it.k === 'year' && it.fontRole === 'display')) return key;
  if (!def.items.some((it) => it.k === 'headline') || def.items.some((it) => it.k === 'body' || it.k === 'message')) return key;
  const big = `${key}+year`;
  STACKS[big] ??= {
    min: [Math.max(def.min[0], 1.3), def.min[1] + 0.75],
    items: [
      { k: 'year', w: 4.2, size: 0.22, fontRole: 'display' },
      ...def.items.filter((it) => it.k !== 'year').map((it) => (it.k === 'headline' ? { ...it, w: Math.min(it.w, 1.7) } : it)),
    ],
  };
  return big;
}

/**
 * A stack only needs the height its greeting can use at the width it has (type is sized by the
 * narrower of the two). In a taller zone the stack becomes a compact block at the anchor instead
 * of spreading its lines from top to bottom.
 */
export function compact(c, r, key, anchor = 'middle') {
  const def = STACKS[key];
  const head = def?.items.find((it) => it.k === 'headline' || it.fontRole === 'display' || it.k === 'monogram');
  const place = (need) => {
    if (need >= r.h * 0.9) return r;
    const y = anchor === 'top' ? r.y : anchor === 'bottom' ? r.y + r.h - need : r.y + (r.h - need) / 2;
    return R(r.x, y, r.w, need);
  };
  if (!head) {
    // Notes and sign-offs: a block a little taller than their minimum. Letters keep the whole zone.
    if (!def || def.items.some((it) => it.k === 'body')) return r;
    return place(def.min[1] * 1.35 + 0.3);
  }
  const mono = head.k === 'monogram';
  const numerals = head.k === 'year';
  const cap = (head.size ?? (mono ? 0.34 : 0.17)) * c.u;
  const headH = Math.min(r.w * (mono ? 0.8 : numerals ? 0.5 : 0.29), cap / (mono ? 0.78 : numerals ? 0.6 : 0.56));
  const total = def.items.reduce((a, it) => a + it.w, 0) * 1.12; // room for a themed divider
  const need = Math.max(def.min[1], (headH * total) / head.w + 0.07 * def.items.length);
  if (need >= r.h * 0.9) return r;
  const y = anchor === 'top' ? r.y : anchor === 'bottom' ? r.y + r.h - need : r.y + (r.h - need) / 2;
  return R(r.x, y, r.w, need);
}

/* ------------------------------ JSON output ------------------------------ */

const r4 = (v) => Math.round(v * 10000) / 10000;
const r3 = (v) => Math.round(v * 1000) / 1000;
const EDGE = 0.002;

/**
 * Elements that clipping to the trim box would distort. A plain rectangle (or photo) running off
 * the edge is just bleed, but an ellipse, a masked photo, an ornament or a rotated box would be
 * squashed out of shape, so the layout is rejected instead.
 */
export function clipIssues(c, els) {
  const out = [];
  els.forEach((e, i) => {
    const shaped = (e.type === 'shape' && e.shape && e.shape !== 'rect' && e.shape !== 'line')
      || e.type === 'ornament' || (e.type === 'photo' && e.mask && e.mask !== 'rect' && e.mask !== 'rounded') || e.rotation;
    if (!shaped) return;
    const cutX = Math.max(0, -e.x) + Math.max(0, e.x + e.w - c.W);
    const cutY = Math.max(0, -e.y) + Math.max(0, e.y + e.h - c.H);
    if (cutX > e.w * 0.02 || cutY > e.h * 0.02) out.push(`element ${i} (${e.type}${e.shape ? ' ' + e.shape : ''}${e.mask ? ' ' + e.mask : ''}) runs off the card and would be squashed`);
  });
  return out;
}

/** Convert inch-space elements to style-pack layout elements for one orientation. */
export function toLayout(c, els) {
  return els.map((e) => {
    let { x, y, w, h } = e;
    // Keep everything inside the trim box (bleed is added by the renderer).
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(c.W, x + w), y1 = Math.min(c.H, y + h);
    x = x0; y = y0; w = x1 - x0; h = y1 - y0;
    const rect = [r4(x / c.W), r4(y / c.H), r4(w / c.W), r4(h / c.H)];
    const out = { type: e.type };
    if (e.type === 'photo') out.slot = e.slot;
    if (e.type === 'text') out.role = e.role;
    if (e.type === 'ornament') out.asset = e.asset;
    out.rect = rect;
    const touches = rect[0] <= EDGE || rect[1] <= EDGE || rect[0] + rect[2] >= 1 - EDGE || rect[1] + rect[3] >= 1 - EDGE;
    if ((e.type === 'photo' || e.type === 'scrim' || e.type === 'shape') && touches && !e.rotation) out.bleed = true;
    if (e.rotation) out.rotation = r3(e.rotation);
    if (e.opacity !== undefined && e.opacity !== 1) out.opacity = r3(e.opacity);
    switch (e.type) {
      case 'photo':
        if (e.mask && e.mask !== 'rect') out.mask = e.mask;
        if (e.mask === 'rounded') out.radiusIn = r3(e.radius ?? 0.12);
        if (e.frameStyle && e.frameStyle !== 'none') out.frameStyle = e.frameStyle;
        if (e.shadow) out.shadow = true;
        if (e.focusArea) out.focusArea = Object.fromEntries(Object.entries(e.focusArea).map(([k, v]) => [k, r3(v)]));
        break;
      case 'text':
        if (e.size !== undefined) out.sizeRel = r3(e.size);
        for (const k of ['fontRole', 'align', 'vAlign', 'color', 'fill', 'lineHeight']) if (e[k] !== undefined) out[k] = e[k];
        break;
      case 'ornament':
        if (e.color) out.color = e.color;
        if (e.color2) out.color2 = e.color2;
        if (e.flipX) out.flipX = true;
        break;
      case 'shape':
        if (e.shape && e.shape !== 'rect') out.shape = e.shape;
        if (e.fill !== undefined) out.fill = e.fill;
        if (e.radius) out.radius = r3(e.radius);
        break;
      case 'scrim':
        for (const k of ['direction', 'color']) if (e[k] !== undefined) out[k] = e[k];
        out.strength = r3(e.strength);
        out.extent = r3(e.extent);
        break;
    }
    return out;
  });
}

/* ------------------------------ signatures ------------------------------ */

const q = (v) => Math.round(v * 100);
const rectKey = (r) => r.map(q).join(',');

/** Photo geometry of a layout (what makes two layouts "the same grid"). */
export function photoSignature(layout) {
  return layout
    .filter((e) => e.type === 'photo')
    .map((e) => `${rectKey(e.rect)}|${e.mask ?? 'rect'}|${e.frameStyle ?? ''}|${Math.round(e.rotation ?? 0)}`)
    .sort()
    .join(';');
}

/** Full geometry: photos, text boxes, shapes and scrims (ornament artwork excluded). */
export function fullSignature(layout) {
  return layout
    .filter((e) => e.type !== 'ornament')
    .map((e) => `${e.type}:${e.role ?? e.shape ?? e.direction ?? ''}:${rectKey(e.rect)}:${e.mask ?? ''}`)
    .sort()
    .join(';');
}
