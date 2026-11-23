// Geometry and artwork checks for generated layouts and ornaments.
import { SAFE } from './engine.mjs';
import { contrastRatio } from '../../packages/shared/src/color.ts';
import { ROLE_DEFAULTS } from '../../packages/shared/src/templates/builtin.ts';

const EPS = 1e-6;
const area = (r) => r[2] * r[3];
function overlap(a, b) {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
const YEAR = /\b(19|20)\d{2}\b/;

/**
 * Problems with one orientation's element list for an n-photo template:
 *  - rects are finite, positive and inside the trim box
 *  - photo slots are exactly 0..n-1
 *  - text stays inside the safe zone and never collides with other text
 *  - text over a photo has a scrim or a backing shape behind it, in a colour that reads on it
 *  - no fixed years: the year always comes from the {{year}} token
 */
export function checkLayout(els, n) {
  const out = [];
  for (const [i, e] of els.entries()) {
    const r = e.rect;
    if (!Array.isArray(r) || r.length !== 4 || r.some((v) => typeof v !== 'number' || !Number.isFinite(v))) { out.push(`element ${i}: bad rect`); continue; }
    if (r[2] <= 0 || r[3] <= 0) out.push(`element ${i} (${e.type}): empty rect`);
    if (r[0] < -EPS || r[1] < -EPS || r[0] + r[2] > 1 + EPS || r[1] + r[3] > 1 + EPS) out.push(`element ${i} (${e.type}): outside the card`);
    if (e.type === 'text') {
      if (r[0] < SAFE - 0.001 || r[1] < SAFE - 0.001 || r[0] + r[2] > 1 - SAFE + 0.001 || r[1] + r[3] > 1 - SAFE + 0.001) out.push(`text ${e.role}: outside the safe zone`);
      if (typeof e.text === 'string' && YEAR.test(e.text)) out.push(`text ${e.role}: fixed year "${e.text}" (use {{year}})`);
    }
  }
  const slots = els.filter((e) => e.type === 'photo').map((e) => e.slot).sort((a, b) => a - b);
  const want = Array.from({ length: n }, (_, i) => i);
  if (slots.length !== n || slots.some((s, i) => s !== want[i])) out.push(`photo slots [${slots}] (want 0..${n - 1})`);

  const texts = els.map((e, i) => ({ e, i })).filter((x) => x.e.type === 'text');
  // Each role gets its copy from the greeting library, so a repeated role prints the same words twice.
  const roles = texts.map((x) => x.e.role).filter((r) => r !== 'custom');
  for (const r of new Set(roles)) if (roles.filter((x) => x === r).length > 1) out.push(`text role ${r} used twice (same words printed twice)`);
  for (let a = 0; a < texts.length; a++)
    for (let b = a + 1; b < texts.length; b++)
      if (overlap(texts[a].e.rect, texts[b].e.rect) > 0.0002) out.push(`text ${texts[a].e.role} overlaps text ${texts[b].e.role}`);

  for (const { e: t, i: ti } of texts) {
    const ta = area(t.rect);
    // Text must not sit on a bold accent shape (ribbon, block, circle) unless a panel covers it first.
    const loud = els.slice(0, ti).map((e, i) => ({ e, i })).filter((x) => x.e.type === 'shape' && x.e.shape !== 'line'
      && (x.e.rotation || x.e.fill === '@accent' || x.e.fill === '@accent2') && (x.e.opacity ?? 1) >= 0.5 && overlap(x.e.rect, t.rect) > ta * 0.08);
    if (loud.length) {
      const last = Math.max(...loud.map((x) => x.i));
      const cover = els.slice(last + 1, ti).some((e) => (e.type === 'scrim' || (e.type === 'shape' && e.shape !== 'line' && !e.rotation && e.fill !== '@accent' && e.fill !== '@accent2')) && overlap(e.rect, t.rect) >= ta * 0.85);
      if (!cover) out.push(`text ${t.role} sits on an accent shape without a panel`);
    }
    const under = els.slice(0, ti).map((e, i) => ({ e, i })).filter((x) => x.e.type === 'photo' && overlap(x.e.rect, t.rect) > ta * 0.08);
    if (!under.length) continue;
    const lastPhoto = Math.max(...under.map((x) => x.i));
    const backs = els.slice(lastPhoto + 1, ti).filter((e) => (e.type === 'scrim' || (e.type === 'shape' && e.shape !== 'line')) && overlap(e.rect, t.rect) >= ta * 0.85);
    if (!backs.length) { out.push(`text ${t.role} sits on a photo without a scrim or backing`); continue; }
    const b = backs[backs.length - 1];
    const ink = t.color;
    if (b.type === 'scrim' && ink !== '@onPhoto' && t.fill !== 'foil') out.push(`text ${t.role} on a scrim should use @onPhoto`);
    if (b.type === 'shape' && b.fill === '@text' && ink !== '@background') out.push(`text ${t.role} on a dark panel should use @background`);
    if (b.type === 'shape' && b.fill !== '@text' && ink === '@onPhoto') out.push(`text ${t.role} on a light panel should not use @onPhoto`);
  }
  return out;
}

/** Large display type needs 3:1 against what is behind it (the Print Guardian's "large text" bar). */
export const FOIL_MIN_CONTRAST = 3;

/**
 * What text element `ti` sits on: "photo" (a photo or a scrim over one), the fill token of the
 * nearest opaque panel that covers it, or "@background" (the card itself).
 */
export function backingOf(els, ti) {
  return backing(els, ti).fill;
}

/**
 * The backing plus how much to ask of it: a see-through panel (a 93% plaque over a photo) lets
 * the picture shift its colour, so text on it must clear the bar by 20%.
 */
function backing(els, ti) {
  const t = els[ti];
  const ta = area(t.rect);
  let under = false; // anything other than paper below the panel
  for (let i = 0; i < ti; i++) if (els[i].type === 'photo' && overlap(els[i].rect, t.rect) > 0) under = true;
  for (let i = ti - 1; i >= 0; i--) {
    const e = els[i];
    if (overlap(e.rect, t.rect) < ta * 0.85) continue;
    if (e.type === 'photo' || e.type === 'scrim') return { fill: 'photo', margin: 1 };
    if (e.type === 'shape' && e.shape !== 'line' && (e.opacity ?? 1) >= 0.85) return { fill: e.fill ?? '@accent', margin: (e.opacity ?? 1) < 1 && under ? 1.2 : 1 };
  }
  return { fill: '@background', margin: 1 };
}

/**
 * Keep foil only where it reads: never on photos or accent colours, and on a theme colour only
 * when the foil's contrast against it (for the pack's default theme) reaches FOIL_MIN_CONTRAST.
 * Text that loses its foil keeps its ink colour. Mutates and returns the layout.
 */
export function settleFoil(els, contrast) {
  els.forEach((e, i) => {
    if (e.type !== 'text' || e.fill !== 'foil') return;
    const b = backing(els, i);
    if (!(contrast?.[b.fill] >= FOIL_MIN_CONTRAST * b.margin)) delete e.fill;
  });
  return els;
}

/** Foil text that would read poorly with the pack's default theme. */
export function foilIssues(els, contrast) {
  const out = [];
  els.forEach((e, i) => {
    if (e.type !== 'text' || e.fill !== 'foil') return;
    const b = backing(els, i);
    const ratio = contrast?.[b.fill];
    if (!(ratio >= FOIL_MIN_CONTRAST * b.margin)) out.push(`foil ${e.role} on ${b.fill} reads at ${ratio ? ratio.toFixed(1) : '?'}:1 (needs ${FOIL_MIN_CONTRAST * b.margin}:1)`);
  });
  return out;
}

/*
 * Accent-coloured type. Subheads, years and monograms default to the theme accent, which on some
 * occasion palettes is too light for small text on the card's own paper. The guardian wants 4.5:1
 * for small text and 3:1 for large (18 pt and up); sizes are judged on the smallest card side
 * HomeCard prints (4″), so a layout that passes there passes on every format.
 */
const SMALLEST_SIDE_IN = 4;
const isLarge = (e) => (e.sizeRel ?? ROLE_DEFAULTS[e.role]?.size ?? 0.04) * SMALLEST_SIDE_IN * 72 >= 18;
const inkOf = (e) => e.color ?? ROLE_DEFAULTS[e.role]?.color ?? '@text';
const ACCENTS = new Set(['@accent', '@accent2']);

function inkProblem(els, i, colors) {
  const e = els[i];
  if (e.type !== 'text' || e.fill === 'foil' || !ACCENTS.has(inkOf(e))) return null;
  const { fill: back, margin } = backing(els, i);
  if (!colors[back]) return null; // photos carry their own ink; accent panels are not paper
  const need = (isLarge(e) ? 3 : 4.5) * margin;
  const ratio = contrastRatio(colors[inkOf(e)], colors[back]);
  return ratio >= need ? null : { back, need, ratio };
}

/** Swap accent ink that would not read for the theme's muted (or main) text colour. */
export function settleInk(els, colors) {
  if (!colors) return els;
  els.forEach((e, i) => {
    const p = inkProblem(els, i, colors);
    if (!p) return;
    e.color = contrastRatio(colors['@textMuted'], colors[p.back]) >= p.need ? '@textMuted' : '@text';
  });
  return els;
}

/** Accent text that would read poorly with the pack's default theme. */
export function inkIssues(els, colors) {
  if (!colors) return [];
  return els.map((e, i) => [e, inkProblem(els, i, colors)]).filter(([, p]) => p)
    .map(([e, p]) => `${e.role} in ${inkOf(e)} on ${p.back} reads at ${p.ratio.toFixed(1)}:1 (needs ${p.need}:1)`);
}

/** Minimal XML well-formedness check (tags balance, attributes quoted). */
export function wellFormed(xml) {
  const stack = [];
  const re = /<\/?([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let m;
  let last = 0;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    if (/[<>]/.test(between)) return `stray markup near "${between.slice(0, 40)}"`;
    last = re.lastIndex;
    if (!m[1]) continue;
    if (m[0].startsWith('</')) {
      if (stack.pop() !== m[1]) return `unbalanced </${m[1]}>`;
    } else if (!m[3]) stack.push(m[1]);
  }
  if (/[<>]/.test(xml.slice(last))) return 'stray markup at the end';
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}

/** Artwork rules for pack SVGs. */
export function checkSvg(src) {
  const out = [];
  if (!/^<svg\b[^>]*\bviewBox="[\d.\s-]+"/.test(src)) out.push('needs a viewBox on the root <svg>');
  if (/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(src)) out.push('scripts or event handlers');
  if (/(?:href|url\()\s*=?\s*["']?\s*(https?:|\/\/|file:)/i.test(src) || /https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(src)) out.push('external reference');
  if (/style="/.test(src)) out.push('inline style (recolouring needs fill/stroke attributes)');
  const wf = wellFormed(src);
  if (wf) out.push(`not well-formed: ${wf}`);
  return out;
}
