// Occasion settings for the themed layout packs, the "dress" each pack applies to the layout
// skeletons, and the five recolourable SVG ornaments drawn for every occasion.
import { BUILTIN_ORNAMENTS } from '../../packages/shared/src/ornaments.ts';
import { BUILTIN_FOILS, contrastRatio } from '../../packages/shared/src/color.ts';
import { themeForOccasion } from '../../packages/shared/src/project.ts';

/**
 * How well the occasion's foil reads on each theme colour it could sit on, for its default theme.
 * Gold and silver foil are mid-tones: they read on the dark side of a theme (the text colour of a
 * light theme, the background of a dark one) and not on cream paper.
 */
/** The occasion's default theme colours as "@token" → hex. */
export function themeColors(occasionId) {
  return Object.fromEntries(Object.entries(themeForOccasion(occasionId).colors).map(([k, v]) => [`@${k}`, v]));
}

export function foilContrast(occasionId) {
  const t = themeForOccasion(occasionId);
  const mid = BUILTIN_FOILS.find((f) => f.id === t.foil)?.mid ?? BUILTIN_FOILS[0].mid;
  return Object.fromEntries(['background', 'surface', 'text'].map((k) => [`@${k}`, contrastRatio(mid, t.colors[k])]));
}

/* ------------------------------ occasions ------------------------------ */

// motif: built-in ornament used inside this occasion's artwork. acc: small accent symbol.
// crest/divider/corner/frame: drawing styles. masks: photo shapes this occasion likes.
// st: stack preferences per zone kind (band, overlay, badge, tile, large).
const HOLIDAY = { band: ['crest', 'formal', 'classic', 'message'], overlay: ['classic', 'caption', 'minimal'], badge: ['minimal', 'caption', 'headline'], tile: ['crest', 'classic', 'minimal'], large: ['crest', 'message', 'formal'] };
const PARTY = { band: ['year-first', 'big-year', 'editorial', 'formal'], overlay: ['year-first', 'editorial', 'caption'], badge: ['caption', 'minimal', 'headline'], tile: ['year-first', 'caption', 'minimal'], large: ['big-year', 'year-first', 'formal'] };
const LOVE = { band: ['names-first', 'formal', 'crest', 'classic'], overlay: ['names-first', 'minimal', 'caption'], badge: ['minimal', 'caption', 'headline'], tile: ['names-first', 'crest', 'minimal'], large: ['monogram', 'names-first', 'formal'] };
const WARM = { band: ['crest', 'message', 'classic', 'formal'], overlay: ['classic', 'minimal', 'caption'], badge: ['minimal', 'caption', 'headline'], tile: ['crest', 'minimal', 'classic'], large: ['message', 'crest', 'formal'] };
const BOLD = { band: ['editorial', 'crest', 'classic', 'formal'], overlay: ['editorial', 'classic', 'caption'], badge: ['caption', 'minimal', 'headline'], tile: ['editorial', 'minimal', 'caption'], large: ['editorial', 'crest', 'message'] };
const NEWS = { band: ['announce', 'crest', 'names-first', 'classic'], overlay: ['classic', 'minimal', 'caption'], badge: ['minimal', 'caption', 'headline'], tile: ['announce', 'crest', 'minimal'], large: ['announce', 'monogram', 'crest'] };

export const OCCASION_SETUP = [
  { id: 'christmas', code: 'xmas', motif: 'tree', acc: 'star', scatter: ['snowflake', 'star'], crest: 'ring', divider: 'taper', corner: 'curl', frame: 'double', masks: ['arch', 'circle', 'rounded', 'scallop'], st: HOLIDAY, foil: true },
  { id: 'hanukkah', code: 'hanukkah', motif: 'menorah', acc: 'star6', scatter: ['star-of-david', 'dreidel'], crest: 'arch', divider: 'diamond', corner: 'bracket', frame: 'notched', masks: ['arch', 'rounded', 'circle'], st: HOLIDAY, foil: true },
  { id: 'kwanzaa', code: 'kwanzaa', motif: 'kinara', acc: 'diamond', scatter: ['sun'], crest: 'diamond', divider: 'double', corner: 'deco', frame: 'rope', masks: ['rounded', 'circle', 'rect'], st: WARM, foil: false },
  { id: 'holiday', code: 'seasons', motif: 'snowflake', acc: 'spark', scatter: ['snowflake-crystal', 'sparkle'], crest: 'scallop', divider: 'dots', corner: 'curl', frame: 'dotted', masks: ['circle', 'arch', 'rounded'], st: HOLIDAY, foil: true },
  { id: 'winter-solstice', code: 'solstice', motif: 'sun', acc: 'star', scatter: ['moon-stars', 'star'], crest: 'burst', divider: 'dots', corner: 'dots', frame: 'double', masks: ['circle', 'ellipse', 'arch'], st: WARM, foil: false },
  { id: 'new-year', code: 'newyear', motif: 'firework', acc: 'spark', scatter: ['sparkle', 'star', 'champagne'], crest: 'burst', divider: 'diamond', corner: 'deco', frame: 'deco', masks: ['rect', 'rounded', 'circle'], st: PARTY, foil: true, bigYear: true },
  { id: 'valentines', code: 'valentines', motif: 'heart', acc: 'heart', scatter: ['heart', 'heart-outline'], crest: 'scallop', divider: 'scroll', corner: 'curl', frame: 'scallop', masks: ['heart', 'ellipse', 'arch', 'scallop'], st: LOVE, foil: true },
  { id: 'lunar-new-year', code: 'lunar', motif: 'lunar-lantern', acc: 'blossom', scatter: ['plum-blossom'], crest: 'ring', divider: 'double', corner: 'bracket', frame: 'notched', masks: ['circle', 'arch', 'rounded'], st: HOLIDAY, foil: true },
  { id: 'st-patricks', code: 'stpatricks', motif: 'shamrock', acc: 'clover', scatter: ['shamrock'], crest: 'scallop', divider: 'dots', corner: 'leafy', frame: 'rope', masks: ['circle', 'rounded', 'scallop'], st: BOLD, foil: true },
  { id: 'easter', code: 'easter', motif: 'egg', acc: 'dot', scatter: ['egg', 'tulip'], crest: 'scallop', divider: 'scroll', corner: 'leafy', frame: 'scallop', masks: ['scallop', 'arch', 'ellipse', 'rounded'], st: WARM, foil: false },
  { id: 'passover', code: 'passover', motif: 'kiddush-cup', acc: 'diamond', scatter: ['olive-branch'], crest: 'arch', divider: 'diamond', corner: 'bracket', frame: 'double', masks: ['arch', 'rounded'], st: HOLIDAY, foil: true },
  { id: 'eid-al-fitr', code: 'eidfitr', motif: 'crescent-star', acc: 'star', scatter: ['star', 'lantern'], crest: 'arch', divider: 'diamond', corner: 'deco', frame: 'notched', masks: ['arch', 'circle', 'rounded'], st: HOLIDAY, foil: true },
  { id: 'eid-al-adha', code: 'eidadha', motif: 'lantern', acc: 'star8', scatter: ['crescent-star', 'star'], crest: 'diamond', divider: 'taper', corner: 'bracket', frame: 'deco', masks: ['arch', 'rounded', 'ellipse'], st: HOLIDAY, foil: true },
  { id: 'mothers-day', code: 'mothers', motif: 'tulip', acc: 'blossom', scatter: ['tulip', 'heart'], crest: 'laurel', divider: 'scroll', corner: 'leafy', frame: 'scallop', masks: ['heart', 'scallop', 'ellipse', 'arch'], st: WARM, foil: false },
  { id: 'fathers-day', code: 'fathers', motif: 'necktie', acc: 'diamond', scatter: ['star'], crest: 'diamond', divider: 'double', corner: 'bracket', frame: 'notched', masks: ['rect', 'rounded', 'stamp'], st: BOLD, foil: false },
  { id: 'graduation', code: 'grad', motif: 'grad-cap', acc: 'star', scatter: ['star', 'sparkle'], crest: 'laurel', divider: 'diamond', corner: 'deco', frame: 'deco', masks: ['rect', 'circle', 'rounded'], st: PARTY, foil: true, bigYear: true },
  { id: 'july-4', code: 'july4', motif: 'firework', acc: 'star', scatter: ['star', 'star-outline'], crest: 'burst', divider: 'taper', corner: 'dots', frame: 'dashed', masks: ['rect', 'circle', 'stamp'], st: BOLD, foil: false },
  { id: 'rosh-hashanah', code: 'roshhashanah', motif: 'apple', acc: 'leaf', scatter: ['pomegranate', 'apple'], crest: 'laurel', divider: 'scroll', corner: 'leafy', frame: 'double', masks: ['circle', 'arch', 'rounded'], st: WARM, foil: true },
  { id: 'diwali', code: 'diwali', motif: 'diya', acc: 'spark', scatter: ['rangoli', 'sparkle'], crest: 'burst', divider: 'dots', corner: 'deco', frame: 'notched', masks: ['arch', 'circle', 'scallop'], st: HOLIDAY, foil: true },
  { id: 'halloween', code: 'halloween', motif: 'pumpkin', acc: 'star', scatter: ['bat', 'star'], crest: 'arch', divider: 'dots', corner: 'curl', frame: 'dashed', masks: ['arch', 'circle', 'stamp'], st: BOLD, foil: false },
  { id: 'thanksgiving', code: 'thanks', motif: 'maple-leaf', acc: 'leaf', scatter: ['maple-leaf', 'wheat'], crest: 'laurel', divider: 'scroll', corner: 'leafy', frame: 'rope', masks: ['rounded', 'arch', 'scallop'], st: WARM, foil: false },
  { id: 'birth', code: 'birth', motif: 'rattle', acc: 'star', scatter: ['moon-stars', 'star'], crest: 'scallop', divider: 'dots', corner: 'dots', frame: 'scallop', masks: ['scallop', 'rounded', 'circle', 'ellipse', 'heart'], st: NEWS, foil: false },
  { id: 'first-birthday', code: 'firstbday', motif: 'cake', acc: 'dot', scatter: ['balloon', 'star'], crest: 'burst', divider: 'dots', corner: 'dots', frame: 'dashed', masks: ['circle', 'scallop', 'rounded'], st: NEWS, foil: false },
  { id: 'new-home', code: 'newhome', motif: 'house', acc: 'diamond', scatter: ['key', 'house'], crest: 'arch', divider: 'double', corner: 'bracket', frame: 'notched', masks: ['rect', 'rounded', 'arch', 'stamp'], st: { band: ['address', 'announce', 'crest', 'classic'], overlay: ['classic', 'minimal', 'caption'], badge: ['minimal', 'caption', 'headline'], tile: ['address', 'crest', 'minimal'], large: ['address', 'announce', 'crest'] }, foil: false },
  { id: 'wedding', code: 'wedding', motif: 'rings', acc: 'diamond', scatter: ['sparkle', 'heart-outline'], crest: 'laurel', divider: 'scroll', corner: 'curl', frame: 'double', masks: ['arch', 'ellipse', 'circle', 'heart'], st: LOVE, foil: true },
  { id: 'save-the-date', code: 'savedate', motif: 'envelope', acc: 'heart', scatter: ['heart', 'sparkle'], crest: 'ring', divider: 'diamond', corner: 'deco', frame: 'deco', masks: ['arch', 'ellipse', 'stamp', 'circle'], st: { ...LOVE, band: ['date', 'names-first', 'formal'], tile: ['date', 'minimal', 'caption'], large: ['date', 'monogram', 'formal'] }, foil: true },
  { id: 'thank-you', code: 'thankyou', motif: 'envelope', acc: 'blossom', scatter: ['heart', 'tulip'], crest: 'laurel', divider: 'scroll', corner: 'leafy', frame: 'scallop', masks: ['rounded', 'scallop', 'circle'], st: { band: ['minimal', 'crest', 'message', 'classic'], overlay: ['minimal', 'caption', 'classic'], badge: ['headline', 'minimal', 'caption'], tile: ['crest', 'minimal', 'headline'], large: ['message', 'crest', 'formal'] }, foil: false },
  { id: 'custom', code: 'custom', motif: 'sparkle', acc: 'spark', scatter: ['sparkles', 'star'], crest: 'ring', divider: 'diamond', corner: 'curl', frame: 'double', masks: ['rounded', 'circle', 'arch'], st: WARM, foil: false },
];

/* ------------------------------ dresses ------------------------------ */

export const GENERIC_DRESS = {
  generic: true,
  div: 'divider-diamond', divAspect: 10,
  icon: '@icon',
  frame: 'frame-double', frame2: 'frame-deco', frameRound: 'frame-double',
  corner: 'corner-flourish',
  scatter: 'confetti',
  foil: false,
  masks: ['rect', 'rounded', 'circle', 'ellipse', 'arch', 'scallop', 'stamp'],
  stacks: {
    band: ['classic', 'formal', 'editorial', 'message', 'minimal', 'crest'],
    overlay: ['classic', 'minimal', 'editorial', 'caption'],
    badge: ['minimal', 'caption', 'classic', 'headline'],
    tile: ['classic', 'minimal', 'caption', 'editorial'],
    large: ['message', 'formal', 'crest', 'classic', 'editorial'],
  },
};

export function occasionDress(o, packId) {
  const a = (f) => `pack:${packId}/ornaments/${f}`;
  return {
    generic: false,
    div: a('divider.svg'), divAspect: 6,
    icon: a('crest.svg'),
    frame: a('frame.svg'), frame2: a('frame.svg'), frameRound: a('frame.svg'),
    corner: a('corner.svg'),
    scatter: a('scatter.svg'),
    foil: o.foil,
    foilContrast: o.foil ? foilContrast(o.id) : null,
    themeColors: themeColors(o.id),
    bigYear: !!o.bigYear,
    masks: o.masks,
    stacks: o.st,
  };
}

/* ------------------------------ SVG artwork ------------------------------ */

const INK = '#2e2a26';
const INK2 = '#b08d57';
const n = (v) => Math.round(v * 100) / 100;
const BUILTIN = new Map(BUILTIN_ORNAMENTS.map((o) => [o.id, o]));

/**
 * A built-in ornament as plain recolourable SVG: CSS colour styles become fill/stroke attributes,
 * and shapes drawn in the second colour get class="tone2".
 */
function builtinBody(id) {
  const o = BUILTIN.get(id);
  if (!o) throw new Error(`Unknown built-in ornament ${id}`);
  const vb = /viewBox="([^"]+)"/.exec(o.svg)[1].split(/\s+/).map(Number);
  let body = o.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  body = body.replace(/<(\w+)([^>]*?)\sstyle="([^"]*)"/g, (_m, tag, before, style) => {
    const attrs = [];
    let tone2 = false;
    for (const decl of style.split(';')) {
      const [k, ...rest] = decl.split(':');
      const key = k?.trim();
      const v = rest.join(':').trim();
      if (!key || !v) continue;
      if (v.startsWith('var(--hc-orn2')) {
        tone2 = true;
        attrs.push(`${key}="${INK2}"`);
      } else if (v === 'currentColor') attrs.push(`${key}="${INK}"`);
      else attrs.push(`${key}="${v}"`);
    }
    if (tone2) attrs.push('class="tone2"');
    return `<${tag}${before} ${attrs.join(' ')}`;
  });
  return { vb, body };
}

/** Place a built-in motif centred at (cx, cy), fitting a size × size box. */
function motif(id, cx, cy, size, extra = '') {
  const { vb, body } = builtinBody(id);
  const [x0, y0, w, h] = vb;
  const k = size / Math.max(w, h);
  return `<g transform="translate(${n(cx - (w * k) / 2 - x0 * k)} ${n(cy - (h * k) / 2 - y0 * k)}) scale(${n(k * 1000) / 1000})"${extra}>${body}</g>`;
}

function starPts(cx, cy, ro, ri, pts = 5, rot = -90) {
  const out = [];
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = ((rot + (180 / pts) * i) * Math.PI) / 180;
    out.push(`${n(cx + r * Math.cos(a))},${n(cy + r * Math.sin(a))}`);
  }
  return out.join(' ');
}

/** Small accent symbols. */
function accent(kind, cx, cy, s, tone2 = true) {
  const c = tone2 ? `class="tone2" fill="${INK2}"` : `fill="${INK}"`;
  switch (kind) {
    case 'star': return `<polygon ${c} points="${starPts(cx, cy, s / 2, s / 4.6)}"/>`;
    case 'star6': return `<polygon ${c} points="${starPts(cx, cy, s / 2, s / 3.6, 6)}"/>`;
    case 'star8': return `<polygon ${c} points="${starPts(cx, cy, s / 2, s / 4, 8)}"/>`;
    case 'spark': return `<path ${c} d="M${n(cx)} ${n(cy - s / 2)} Q${n(cx + s * 0.07)} ${n(cy - s * 0.07)} ${n(cx + s / 2)} ${n(cy)} Q${n(cx + s * 0.07)} ${n(cy + s * 0.07)} ${n(cx)} ${n(cy + s / 2)} Q${n(cx - s * 0.07)} ${n(cy + s * 0.07)} ${n(cx - s / 2)} ${n(cy)} Q${n(cx - s * 0.07)} ${n(cy - s * 0.07)} ${n(cx)} ${n(cy - s / 2)}Z"/>`;
    case 'heart': {
      const k = s / 100;
      return `<path ${c} transform="translate(${n(cx - 50 * k)} ${n(cy - 50 * k)}) scale(${n(k * 1000) / 1000})" d="M50 88 C22 66 6 48 6 31 C6 16 17 6 30 6 C39 6 46 11 50 19 C54 11 61 6 70 6 C83 6 94 16 94 31 C94 48 78 66 50 88Z"/>`;
    }
    case 'diamond': return `<polygon ${c} points="${n(cx)},${n(cy - s / 2)} ${n(cx + s / 2.6)},${n(cy)} ${n(cx)},${n(cy + s / 2)} ${n(cx - s / 2.6)},${n(cy)}"/>`;
    case 'leaf': return `<path ${c} transform="rotate(-40 ${n(cx)} ${n(cy)})" d="M${n(cx - s / 2)} ${n(cy)} Q${n(cx)} ${n(cy - s / 3)} ${n(cx + s / 2)} ${n(cy)} Q${n(cx)} ${n(cy + s / 3)} ${n(cx - s / 2)} ${n(cy)}Z"/>`;
    case 'clover': return [0, 120, 240].map((a) => `<circle ${c} cx="${n(cx + (s / 4.2) * Math.cos(((a - 90) * Math.PI) / 180))}" cy="${n(cy + (s / 4.2) * Math.sin(((a - 90) * Math.PI) / 180))}" r="${n(s / 4.4)}"/>`).join('');
    case 'blossom': return [0, 72, 144, 216, 288].map((a) => `<circle ${c} cx="${n(cx + (s / 3.6) * Math.cos(((a - 90) * Math.PI) / 180))}" cy="${n(cy + (s / 3.6) * Math.sin(((a - 90) * Math.PI) / 180))}" r="${n(s / 5)}"/>`).join('') + `<circle fill="${INK}" cx="${n(cx)}" cy="${n(cy)}" r="${n(s / 8)}"/>`;
    case 'dot':
    default: return `<circle ${c} cx="${n(cx)}" cy="${n(cy)}" r="${n(s / 2.6)}"/>`;
  }
}

const doc = (vb, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>\n`;
const line = (d, sw, extra = '') => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const line2 = (d, sw, extra = '') => `<path class="tone2" d="${d}" fill="none" stroke="${INK2}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

/* ---- crest (ornament, 120 × 120) ---- */
function crestSvg(o) {
  let b = '';
  switch (o.crest) {
    case 'laurel':
      b += motif('laurel', 60, 60, 118) + motif(o.motif, 60, 56, 50);
      break;
    case 'burst': {
      for (let i = 0; i < 24; i++) {
        const a = (i * 15 * Math.PI) / 180, a1 = a - 0.05, a2 = a + 0.05;
        const p = (r, t) => `${n(60 + r * Math.cos(t))},${n(60 + r * Math.sin(t))}`;
        b += `<polygon class="tone2" fill="${INK2}" points="${p(45, a1)} ${p(i % 2 ? 54 : 58, a)} ${p(45, a2)}"/>`;
      }
      b += line('M60 18 A42 42 0 1 1 59.99 18', 2) + motif(o.motif, 60, 60, 50);
      break;
    }
    case 'arch':
      b += line('M22 108 V56 A38 38 0 0 1 98 56 V108 Z', 2.2) + line2('M29 102 V57 A31 31 0 0 1 91 57 V102 Z', 1) + motif(o.motif, 60, 72, 46) + accent(o.acc, 60, 9, 12) + line('M14 112 H106', 1.6);
      break;
    case 'diamond':
      b += line('M60 4 L116 60 L60 116 L4 60 Z', 2) + line2('M60 13 L107 60 L60 107 L13 60 Z', 0.9) + motif(o.motif, 60, 60, 52) + [[60, 4], [116, 60], [60, 116], [4, 60]].map(([x, y]) => accent('dot', x, y, 7)).join('');
      break;
    case 'scallop': {
      let d = '';
      const bumps = 18;
      for (let i = 0; i <= bumps; i++) {
        const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
        const am = ((i - 0.5) / bumps) * Math.PI * 2 - Math.PI / 2;
        const x = 60 + 54 * Math.cos(a), y = 60 + 54 * Math.sin(a);
        if (i === 0) d += `M${n(x)} ${n(y)}`;
        else d += ` Q${n(60 + 60 * Math.cos(am))} ${n(60 + 60 * Math.sin(am))} ${n(x)} ${n(y)}`;
      }
      b += line(d + 'Z', 2) + line2('M60 14 A46 46 0 1 1 59.99 14', 0.9) + motif(o.motif, 60, 60, 54);
      break;
    }
    case 'ring':
    default:
      b += line('M60 5 A55 55 0 1 1 59.99 5', 2.4) + line2('M60 11 A49 49 0 1 1 59.99 11', 0.9) + motif(o.motif, 60, 60, 58) + [[60, 5], [115, 60], [60, 115], [5, 60]].map(([x, y]) => accent(o.acc, x, y, 9)).join('');
  }
  return doc('0 0 120 120', b);
}

/* ---- divider (divider, 240 × 40) ---- */
function dividerSvg(o) {
  let b = motif(o.motif, 120, 20, 30);
  switch (o.divider) {
    case 'taper':
      b += `<polygon fill="${INK}" points="8,20 98,18.4 98,21.6"/><polygon fill="${INK}" points="232,20 142,18.4 142,21.6"/>` + accent(o.acc, 100, 20, 6) + accent(o.acc, 140, 20, 6);
      break;
    case 'dots':
      b += line('M30 20 H96 M144 20 H210', 1.2);
      for (const x of [8, 15, 22, 218, 225, 232]) b += accent('dot', x, 20, x === 22 || x === 218 ? 5 : 3.4);
      break;
    case 'diamond':
      b += line('M6 20 H92 M148 20 H234', 1.3) + accent('diamond', 98, 20, 9) + accent('diamond', 142, 20, 9) + accent('dot', 6, 20, 4, false) + accent('dot', 234, 20, 4, false);
      break;
    case 'scroll':
      b += line('M98 20 C84 20 80 10 70 12 C62 14 64 24 72 22 M70 12 C58 9 40 20 8 20', 1.4) + line('M142 20 C156 20 160 10 170 12 C178 14 176 24 168 22 M170 12 C182 9 200 20 232 20', 1.4) + accent(o.acc, 40, 17, 6) + accent(o.acc, 200, 17, 6);
      break;
    case 'double':
    default:
      b += line('M8 17 H96 M144 17 H232', 1.2) + line2('M18 23 H96 M144 23 H222', 0.9) + accent(o.acc, 8, 23, 6) + accent(o.acc, 232, 23, 6);
  }
  return doc('0 0 240 40', b);
}

/* ---- corner (corner, 100 × 100, drawn for the top-left) ---- */
function cornerSvg(o) {
  const a = ['heart', 'blossom', 'clover'].includes(o.acc) ? 'diamond' : o.acc;
  let b = '';
  switch (o.corner) {
    case 'bracket':
      b += line('M6 94 V6 H94', 2.2) + line2('M14 72 V14 H72', 1) + accent(a, 14, 14, 10);
      break;
    case 'deco':
      b += line('M4 64 V4 H64', 2) + line('M11 50 V11 H50', 1.2) + line2('M18 36 V18 H36', 1) + accent(a, 27, 27, 9);
      break;
    case 'leafy': {
      b += line('M6 96 V20 C6 12 12 6 20 6 H96', 1.8);
      for (const t of [0.3, 0.55, 0.8]) {
        b += `<path class="tone2" fill="${INK2}" transform="translate(${n(6)} ${n(20 + 76 * t)}) rotate(-35)" d="M0 0 Q7 -4 14 0 Q7 4 0 0Z"/>`;
        b += `<path class="tone2" fill="${INK2}" transform="translate(${n(20 + 76 * t)} ${n(6)}) rotate(125)" d="M0 0 Q7 -4 14 0 Q7 4 0 0Z"/>`;
      }
      b += accent(a, 18, 18, 10);
      break;
    }
    case 'dots':
      for (let i = 0; i < 8; i++) {
        const r = 3.4 - i * 0.32;
        b += accent('dot', 8, 20 + i * 10, r * 2.6, i % 2 === 1) + accent('dot', 20 + i * 10, 8, r * 2.6, i % 2 === 1);
      }
      b += accent(a, 9, 9, 12, false);
      break;
    case 'curl':
    default:
      b += line('M6 94 V30 C6 14 14 6 30 6 H94', 2) + line('M6 46 C20 46 28 34 24 24 C20 16 10 18 12 26', 1.6) + line('M46 6 C46 20 34 28 24 24', 1.6) + line2('M14 94 V36 C14 22 22 14 36 14 H94', 0.8) + accent(a, 24, 24, 8, false);
  }
  return doc('0 0 100 100', b);
}

/* ---- frame (frame, stretched to the box, 100 × 140) ---- */
function frameSvg(o) {
  const nss = ' vector-effect="non-scaling-stroke"';
  const rect = (x, y, w, h, sw, extra = '', tone = false) => (tone ? line2 : line)(`M${x} ${y} H${x + w} V${y + h} H${x} Z`, sw, nss + extra);
  let b = '';
  switch (o.frame) {
    case 'deco':
      b += line('M2 12 V2 H12 M88 2 H98 V12 M98 128 V138 H88 M12 138 H2 V128 M16 2 H84 M16 138 H84 M2 16 V124 M98 16 V124', 1.6, nss) + rect(5, 5, 90, 130, 0.9, '', true) + line('M2 12 H12 V2 M88 2 V12 H98 M98 128 H88 V138 M12 138 V128 H2', 0.9, nss);
      break;
    case 'dashed':
      b += rect(2, 2, 96, 136, 1.6) + rect(5, 5, 90, 130, 1.1, ' stroke-dasharray="3 2.2"', true);
      break;
    case 'dotted':
      b += rect(2, 2, 96, 136, 0.9) + rect(5, 5, 90, 130, 2.2, ' stroke-dasharray="0 3.2"', true);
      break;
    case 'notched':
      b += line('M10 2 H90 L98 10 V130 L90 138 H10 L2 130 V10 Z', 1.8, nss) + rect(6, 6, 88, 128, 0.8, '', true);
      break;
    case 'rope':
      b += rect(2, 2, 96, 136, 1.3, ' stroke-dasharray="4 2"') + rect(3.4, 3.4, 93.2, 133.2, 1.3, ' stroke-dasharray="4 2" stroke-dashoffset="3"', true);
      break;
    case 'scallop': {
      let d = 'M2 2';
      const bx = 10, by = 14;
      for (let i = 0; i < bx; i++) d += ` Q${n(2 + (96 / bx) * (i + 0.5))} -1.5 ${n(2 + (96 / bx) * (i + 1))} 2`;
      for (let i = 0; i < by; i++) d += ` Q101.5 ${n(2 + (136 / by) * (i + 0.5))} 98 ${n(2 + (136 / by) * (i + 1))}`;
      for (let i = 0; i < bx; i++) d += ` Q${n(98 - (96 / bx) * (i + 0.5))} 141.5 ${n(98 - (96 / bx) * (i + 1))} 138`;
      for (let i = 0; i < by; i++) d += ` Q-1.5 ${n(138 - (136 / by) * (i + 0.5))} 2 ${n(138 - (136 / by) * (i + 1))}`;
      b += line(d + 'Z', 1.5, nss) + rect(6, 6, 88, 128, 0.7, '', true);
      break;
    }
    case 'double':
    default:
      b += rect(2, 2, 96, 136, 2.2) + rect(5, 5, 90, 130, 0.9, '', true);
  }
  return doc('0 0 100 140', b);
}

/* ---- scatter (scatter, 200 × 140) ---- */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

function scatterSvg(o) {
  const r = rng(hash(o.id));
  const pts = [];
  const want = 30;
  for (let tries = 0; pts.length < want && tries < 4000; tries++) {
    const p = { x: 8 + r() * 184, y: 8 + r() * 124 };
    if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 20)) pts.push(p);
  }
  const syms = [o.motif, ...o.scatter];
  let b = '';
  pts.forEach((p, i) => {
    const kind = i % 5;
    if (kind === 0 || kind === 3) {
      const id = syms[(i >> 1) % syms.length];
      b += motif(id, p.x, p.y, 11 + r() * 5, ` opacity="${i % 3 ? 1 : 0.85}"`).replace('<g ', `<g `);
    } else if (kind === 1 || kind === 4) b += accent(o.acc === 'heart' || o.acc === 'blossom' || o.acc === 'clover' ? o.acc : o.acc, p.x, p.y, 5 + r() * 4, i % 2 === 0);
    else b += accent('dot', p.x, p.y, 2.4 + r() * 2.2, i % 2 === 1);
  });
  return doc('0 0 200 140', b);
}

/** The five ornaments for an occasion pack. */
export function occasionOrnaments(o, occName) {
  return [
    { id: 'crest', name: `${occName} crest`, kind: 'ornament', file: 'ornaments/crest.svg', svg: crestSvg(o), tags: [o.id, 'crest', 'motif'] },
    { id: 'divider', name: `${occName} divider`, kind: 'divider', file: 'ornaments/divider.svg', svg: dividerSvg(o), tags: [o.id, 'divider', 'rule'] },
    { id: 'corner', name: `${occName} corner`, kind: 'corner', file: 'ornaments/corner.svg', svg: cornerSvg(o), tags: [o.id, 'corner'] },
    { id: 'frame', name: `${occName} frame`, kind: 'frame', file: 'ornaments/frame.svg', svg: frameSvg(o), stretch: true, tags: [o.id, 'frame', 'border'] },
    { id: 'scatter', name: `${occName} scatter`, kind: 'scatter', file: 'ornaments/scatter.svg', svg: scatterSvg(o), tags: [o.id, 'scatter', 'pattern'] },
  ];
}
