/**
 * Built-in responsive templates. Each template builds concrete element geometry (inches) for the
 * current card size/orientation, so layouts look intentional on 5×7, 4×8, square, A2, etc.
 * Colours are theme tokens (@text, @accent…) and text sizes are relative to min(w, h).
 */
import type { TemplateParams, TextRole } from '../types';
import type { TemplateContext, TemplateDef, TemplateElement, TPhoto, TText, TOrnament, TShape, TScrim } from './types';

const BASE: TemplateParams = { gutter: 0.08, radius: 0, margin: 0.3 };
const EPS = 1e-6;

const pt = (c: TemplateContext, rel: number) => Math.round(rel * c.unit * 72 * 10) / 10;

interface RoleDefault {
  fontRole: TText['fontRole'];
  size: number;
  lineHeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  transform: 'none' | 'theme';
}

const ROLE_DEFAULTS: Record<TextRole, RoleDefault> = {
  headline: { fontRole: 'display', size: 0.12, lineHeight: 1.05, color: '@text', align: 'center', vAlign: 'middle', transform: 'theme' },
  subhead: { fontRole: 'accent', size: 0.036, lineHeight: 1.25, color: '@accent', align: 'center', vAlign: 'middle', transform: 'theme' },
  names: { fontRole: 'accent', size: 0.034, lineHeight: 1.25, color: '@text', align: 'center', vAlign: 'middle', transform: 'theme' },
  year: { fontRole: 'accent', size: 0.032, lineHeight: 1.1, color: '@accent', align: 'center', vAlign: 'middle', transform: 'theme' },
  message: { fontRole: 'body', size: 0.036, lineHeight: 1.4, color: '@text', align: 'center', vAlign: 'middle', transform: 'none' },
  body: { fontRole: 'body', size: 0.029, lineHeight: 1.45, color: '@text', align: 'left', vAlign: 'top', transform: 'none' },
  small: { fontRole: 'body', size: 0.026, lineHeight: 1.35, color: '@textMuted', align: 'left', vAlign: 'top', transform: 'none' },
  monogram: { fontRole: 'display', size: 0.3, lineHeight: 1, color: '@accent', align: 'center', vAlign: 'middle', transform: 'none' },
  custom: { fontRole: 'body', size: 0.04, lineHeight: 1.3, color: '@text', align: 'center', vAlign: 'middle', transform: 'none' },
};

function text(c: TemplateContext, role: TextRole, x: number, y: number, w: number, h: number, o: Partial<TText> & { size?: number } = {}): TText {
  const d = ROLE_DEFAULTS[role];
  const { size, ...rest } = o;
  return {
    type: 'text',
    role,
    x, y, w, h,
    fontRole: d.fontRole,
    fontSize: pt(c, size ?? d.size),
    lineHeight: d.lineHeight,
    align: d.align,
    vAlign: d.vAlign,
    color: d.color,
    fill: 'color',
    transform: d.transform,
    shadow: false,
    autoFit: true,
    ...rest,
  };
}

const full = (c: TemplateContext) => ({ x: -c.bleed, y: -c.bleed, w: c.w + 2 * c.bleed, h: c.h + 2 * c.bleed });

function photo(slot: number, r: { x: number; y: number; w: number; h: number }, o: Partial<TPhoto> = {}): TPhoto {
  return { type: 'photo', slot, ...r, ...o };
}
const scrim = (r: { x: number; y: number; w: number; h: number }, o: Partial<TScrim>): TScrim => ({
  type: 'scrim', ...r, direction: 'to-top', color: '@scrim', strength: 0.55, extent: 0.3, ...o,
});
const orn = (asset: string, x: number, y: number, w: number, h: number, o: Partial<TOrnament> = {}): TOrnament => ({
  type: 'ornament', asset, x, y, w, h, color: '@accent', color2: '@accent2', ...o,
});
const shape = (r: { x: number; y: number; w: number; h: number }, o: Partial<TShape>): TShape => ({
  type: 'shape', shape: 'rect', fill: '@accent', radius: 0, ...r, ...o,
});

/** Resolve a trim-space rect: edges on the trim are pushed to the bleed (margin 0) or inset by margin. */
function edgeRect(c: TemplateContext, x0: number, y0: number, x1: number, y1: number) {
  const m = c.params.margin, b = c.bleed;
  const L = Math.abs(x0) < EPS ? (m > 0 ? m : -b) : x0;
  const T = Math.abs(y0) < EPS ? (m > 0 ? m : -b) : y0;
  const R = Math.abs(x1 - c.w) < EPS ? (m > 0 ? c.w - m : c.w + b) : x1;
  const B = Math.abs(y1 - c.h) < EPS ? (m > 0 ? c.h - m : c.h + b) : y1;
  return { x: L, y: T, w: R - L, h: B - T };
}

/** Photo grid inside a trim-space area with gutters; outer edges follow edgeRect rules. */
function grid(c: TemplateContext, x0: number, y0: number, x1: number, y1: number, cols: number, rows: number, slot0: number, o: Partial<TPhoto> = {}): TPhoto[] {
  const m = c.params.margin, g = c.params.gutter, b = c.bleed;
  const ax0 = Math.abs(x0) < EPS ? m : x0;
  const ay0 = Math.abs(y0) < EPS ? m : y0;
  const ax1 = Math.abs(x1 - c.w) < EPS ? c.w - m : x1;
  const ay1 = Math.abs(y1 - c.h) < EPS ? c.h - m : y1;
  const cw = (ax1 - ax0 - g * (cols - 1)) / cols;
  const ch = (ay1 - ay0 - g * (rows - 1)) / rows;
  const out: TPhoto[] = [];
  let slot = slot0;
  for (let r = 0; r < rows; r++)
    for (let col = 0; col < cols; col++) {
      let x = ax0 + col * (cw + g), y = ay0 + r * (ch + g), w = cw, h = ch;
      if (m <= 0) {
        if (col === 0 && Math.abs(x0) < EPS) { x -= b; w += b; }
        if (r === 0 && Math.abs(y0) < EPS) { y -= b; h += b; }
        if (col === cols - 1 && Math.abs(x1 - c.w) < EPS) w += b;
        if (r === rows - 1 && Math.abs(y1 - c.h) < EPS) h += b;
      }
      out.push(photo(slot++, { x, y, w, h }, { radius: c.params.radius, mask: c.params.radius > 0 ? 'rounded' : 'rect', ...o }));
    }
  return out;
}

function rotateAbout(px: number, py: number, x: number, y: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const dx = x - px, dy = y - py;
  return [px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Polaroid with an optional rotated caption text element aligned to its bottom border. */
function polaroid(c: TemplateContext, slot: number, x: number, y: number, w: number, h: number, rot: number, captionRole?: TextRole): TemplateElement[] {
  const els: TemplateElement[] = [photo(slot, { x, y, w, h }, { frameStyle: 'polaroid', shadow: true, rotation: rot })];
  if (captionRole) {
    const side = w * 0.06;
    const bottom = Math.min(h * 0.3, w * 0.22);
    const cw = w - side * 2, chh = bottom * 0.8;
    const ccx = x + w / 2, ccy = y + h - bottom / 2;
    const [rx, ry] = rotateAbout(x + w / 2, y + h / 2, ccx, ccy, rot);
    els.push(text(c, captionRole, rx - cw / 2, ry - chh / 2, cw, chh, { rotation: rot, fontRole: 'display', color: '#3a3a3a', size: 0.05, transform: 'none' }));
  }
  return els;
}

const def = (d: Omit<TemplateDef, 'source' | 'defaults' | 'params'> & { params?: TemplateDef['params']; defaults?: Partial<TemplateParams> }): TemplateDef => ({
  source: 'builtin',
  params: d.params ?? [],
  ...d,
  defaults: { ...BASE, ...(d.defaults ?? {}) },
});

const isLand = (c: TemplateContext) => c.orientation === 'landscape';

/* ====================================================================== */

export const BUILTIN_TEMPLATES: TemplateDef[] = [
  def({
    id: 'full-bleed-classic', name: 'Full Bleed Classic', description: 'One edge-to-edge photo with a soft shade behind the greeting.',
    kinds: ['front'], photos: 1, category: 'full-bleed',
    build: (c) => {
      const { w, h, bleed: b } = c;
      const L = isLand(c);
      return [
        photo(0, full(c), { focusArea: { x: 0, y: 0, w: 1, h: L ? 0.56 : 0.62 } }),
        scrim({ x: -b, y: h * 0.42, w: w + 2 * b, h: h * 0.58 + b }, { direction: 'to-top', strength: 0.62, extent: 0.38 }),
        text(c, 'headline', w * 0.08, h * (L ? 0.58 : 0.63), w * 0.84, h * (L ? 0.2 : 0.165), { color: '@onPhoto', size: 0.13, shadow: true }),
        text(c, 'subhead', w * 0.1, h * (L ? 0.785 : 0.8), w * 0.8, h * 0.055, { color: '@onPhoto' }),
        text(c, 'names', w * 0.1, h * (L ? 0.86 : 0.865), w * 0.8, h * 0.05, { color: '@onPhoto' }),
      ];
    },
  }),
  def({
    id: 'full-bleed-top-title', name: 'Top Title', description: 'Full-bleed photo with the greeting across the top.',
    kinds: ['front'], photos: 1, category: 'full-bleed',
    build: (c) => {
      const { w, h, bleed: b } = c;
      return [
        photo(0, full(c), { focusArea: { x: 0, y: 0.3, w: 1, h: 0.7 } }),
        scrim({ x: -b, y: -b, w: w + 2 * b, h: h * 0.42 + b }, { direction: 'to-bottom', strength: 0.55, extent: 0.32 }),
        scrim({ x: -b, y: h * 0.8, w: w + 2 * b, h: h * 0.2 + b }, { direction: 'to-top', strength: 0.45, extent: 0.4 }),
        text(c, 'headline', w * 0.08, h * 0.065, w * 0.84, h * 0.16, { color: '@onPhoto', size: 0.13, shadow: true }),
        text(c, 'subhead', w * 0.1, h * 0.225, w * 0.8, h * 0.05, { color: '@onPhoto' }),
        text(c, 'names', w * 0.1, h * 0.885, w * 0.8, h * 0.05, { color: '@onPhoto' }),
      ];
    },
  }),
  def({
    id: 'center-stage', name: 'Center Stage', description: 'A big centred greeting over a scenic photo.',
    kinds: ['front'], photos: 1, category: 'full-bleed',
    build: (c) => {
      const { w, h, bleed: b } = c;
      return [
        photo(0, full(c), { focusArea: { x: 0, y: 0, w: 1, h: 0.5 } }),
        scrim({ ...full(c) }, { direction: 'solid', strength: 0.14, extent: 1 }),
        scrim({ x: -b, y: h * 0.38, w: w + 2 * b, h: h * 0.62 + b }, { direction: 'to-top', strength: 0.5, extent: 0.5 }),
        text(c, 'headline', w * 0.08, h * 0.5, w * 0.84, h * 0.22, { color: '@onPhoto', size: 0.16, shadow: true }),
        text(c, 'names', w * 0.1, h * 0.74, w * 0.8, h * 0.05, { color: '@onPhoto' }),
        text(c, 'year', w * 0.1, h * 0.8, w * 0.8, h * 0.045, { color: '@onPhoto' }),
      ];
    },
  }),
  def({
    id: 'editorial-cover', name: 'Editorial Cover', description: 'Magazine-style left-aligned headline over a full-bleed photo.',
    kinds: ['front'], photos: 1, category: 'full-bleed',
    build: (c) => {
      const { w, h, bleed: b } = c;
      return [
        photo(0, full(c), { focusArea: { x: 0.1, y: 0.3, w: 0.9, h: 0.7 } }),
        scrim({ x: -b, y: -b, w: w + 2 * b, h: h * 0.45 + b }, { direction: 'to-bottom', strength: 0.5, extent: 0.3 }),
        scrim({ x: -b, y: h * 0.82, w: w + 2 * b, h: h * 0.18 + b }, { direction: 'to-top', strength: 0.45, extent: 0.4 }),
        text(c, 'headline', w * 0.08, h * 0.06, w * 0.84, h * 0.22, { color: '@onPhoto', size: 0.16, align: 'left', vAlign: 'top', shadow: true }),
        text(c, 'subhead', w * 0.08, h * 0.285, w * 0.7, h * 0.05, { color: '@onPhoto', align: 'left' }),
        text(c, 'names', w * 0.08, h * 0.885, w * 0.6, h * 0.05, { color: '@onPhoto', align: 'left' }),
        text(c, 'year', w * 0.62, h * 0.885, w * 0.3, h * 0.05, { color: '@onPhoto', align: 'right' }),
      ];
    },
  }),
  def({
    id: 'year-badge-hero', name: 'Big Year', description: 'Full-bleed photo with an oversized foil year — great for New Year’s & graduation.',
    kinds: ['front'], photos: 1, category: 'full-bleed',
    build: (c) => {
      const { w, h, bleed: b } = c;
      const L = isLand(c);
      return [
        photo(0, full(c), { focusArea: { x: 0, y: 0, w: 1, h: 0.55 } }),
        scrim({ x: -b, y: h * 0.38, w: w + 2 * b, h: h * 0.62 + b }, { direction: 'to-top', strength: 0.66, extent: 0.45 }),
        text(c, 'headline', w * 0.08, h * (L ? 0.5 : 0.55), w * 0.84, h * 0.1, { color: '@onPhoto', size: 0.075, shadow: true }),
        text(c, 'year', w * 0.06, h * (L ? 0.6 : 0.645), w * 0.88, h * (L ? 0.26 : 0.22), { color: '@onPhoto', fill: 'foil', size: L ? 0.3 : 0.27, fontRole: 'display', transform: 'none', lineHeight: 1 }),
        text(c, 'names', w * 0.1, h * 0.88, w * 0.8, h * 0.05, { color: '@onPhoto' }),
      ];
    },
  }),
  def({
    id: 'gallery-frame', name: 'Classic Gallery', description: 'A clean framed photo with a wide border and elegant type below.',
    kinds: ['front', 'back', 'inside'], photos: 1, category: 'framed', params: ['margin', 'radius'], defaults: { margin: 0.32 },
    build: (c) => {
      const { w, h } = c;
      const m = Math.max(0.12, c.params.margin);
      const r = c.params.radius;
      if (isLand(c)) {
        const pw = w * 0.6 - m;
        const tx = m + pw + 0.25, tw = w - tx - m;
        return [
          photo(0, { x: m, y: m, w: pw, h: h - 2 * m }, { radius: r, mask: r > 0 ? 'rounded' : 'rect' }),
          text(c, 'headline', tx, h * 0.2, tw, h * 0.32, { size: 0.12 }),
          text(c, 'subhead', tx, h * 0.53, tw, h * 0.08),
          text(c, 'names', tx, h * 0.66, tw, h * 0.08),
          text(c, 'year', tx, h * 0.75, tw, h * 0.07),
        ];
      }
      const ph = h * 0.66 - m;
      return [
        photo(0, { x: m, y: m, w: w - 2 * m, h: ph }, { radius: r, mask: r > 0 ? 'rounded' : 'rect' }),
        text(c, 'headline', m, h * 0.685, w - 2 * m, h * 0.145, { size: 0.105 }),
        text(c, 'names', m, h * 0.835, w - 2 * m, h * 0.05),
        text(c, 'year', m, h * 0.885, w - 2 * m, h * 0.04),
      ];
    },
  }),
  def({
    id: 'museum-mat', name: 'Museum Mat', description: 'Wide gallery border, fine keyline and understated type.',
    kinds: ['front'], photos: 1, category: 'framed', params: ['margin'], defaults: { margin: 0.55 },
    build: (c) => {
      const { w, h } = c;
      const m = Math.max(0.3, c.params.margin);
      const key = { width: 0.012, color: '@text' };
      if (isLand(c)) {
        const pw = w * 0.6 - m;
        const tx = m + pw + 0.3, tw = w - tx - 0.35;
        return [
          orn('frame-double', m - 0.1, m - 0.1, pw + 0.2, h - 2 * m + 0.2, { color: '@textMuted' }),
          photo(0, { x: m, y: m, w: pw, h: h - 2 * m }, { border: key }),
          text(c, 'headline', tx, h * 0.28, tw, h * 0.26, { size: 0.09 }),
          text(c, 'names', tx, h * 0.58, tw, h * 0.08),
          text(c, 'year', tx, h * 0.67, tw, h * 0.06),
        ];
      }
      const ph = h * 0.7 - m;
      return [
        orn('frame-double', m - 0.1, m - 0.1, w - 2 * m + 0.2, ph + 0.2, { color: '@textMuted' }),
        photo(0, { x: m, y: m, w: w - 2 * m, h: ph }, { border: key }),
        text(c, 'headline', m, h * 0.735, w - 2 * m, h * 0.12, { size: 0.085 }),
        text(c, 'names', m, h * 0.865, w - 2 * m, h * 0.045),
      ];
    },
  }),
  def({
    id: 'split-half', name: 'Half & Half', description: 'Photo on one half, festive greeting and year on the other.',
    kinds: ['front', 'inside'], photos: 1, category: 'split',
    build: (c) => {
      const { w, h, bleed: b } = c;
      if (c.orientation === 'portrait') {
        const ih = h * 0.07;
        return [
          photo(0, { x: -b, y: -b, w: w + 2 * b, h: h * 0.54 + b }),
          orn('@icon', w / 2 - ih / 2, h * 0.575, ih, ih),
          text(c, 'headline', w * 0.08, h * 0.65, w * 0.84, h * 0.15, { size: 0.12 }),
          text(c, 'subhead', w * 0.1, h * 0.8, w * 0.8, h * 0.045),
          text(c, 'names', w * 0.1, h * 0.86, w * 0.8, h * 0.045),
          text(c, 'year', w * 0.1, h * 0.905, w * 0.8, h * 0.035),
        ];
      }
      const tx = w * 0.56, tw = w * 0.4 - 0.1;
      const ih = h * 0.11;
      return [
        photo(0, { x: -b, y: -b, w: w * 0.52 + b, h: h + 2 * b }),
        orn('@icon', tx + tw / 2 - ih / 2, h * 0.13, ih, ih),
        text(c, 'headline', tx, h * 0.27, tw, h * 0.3, { size: 0.12 }),
        text(c, 'subhead', tx, h * 0.58, tw, h * 0.07),
        text(c, 'names', tx, h * 0.69, tw, h * 0.07),
        text(c, 'year', tx, h * 0.77, tw, h * 0.06),
      ];
    },
  }),
  def({
    id: 'split-third-band', name: 'Bold Band', description: 'Big photo with a solid colour band carrying the greeting.',
    kinds: ['front'], photos: 1, category: 'split',
    build: (c) => {
      const { w, h, bleed: b } = c;
      if (isLand(c)) {
        const bx = w * 0.64;
        return [
          photo(0, { x: -b, y: -b, w: bx + b, h: h + 2 * b }),
          shape({ x: bx, y: -b, w: w - bx + b, h: h + 2 * b }, { fill: '@text' }),
          shape({ x: bx, y: -b, w: 0.035, h: h + 2 * b }, { fill: '@accent' }),
          text(c, 'headline', bx + 0.22, h * 0.22, w - bx - 0.5, h * 0.36, { color: '@background', size: 0.12 }),
          text(c, 'subhead', bx + 0.22, h * 0.6, w - bx - 0.5, h * 0.07, { color: '@accent' }),
          text(c, 'names', bx + 0.22, h * 0.7, w - bx - 0.5, h * 0.07, { color: '@background' }),
        ];
      }
      const by = h * 0.68;
      return [
        photo(0, { x: -b, y: -b, w: w + 2 * b, h: by + b }),
        shape({ x: -b, y: by, w: w + 2 * b, h: h - by + b }, { fill: '@text' }),
        shape({ x: -b, y: by, w: w + 2 * b, h: 0.035 }, { fill: '@accent' }),
        text(c, 'headline', w * 0.08, h * 0.705, w * 0.84, h * 0.14, { color: '@background', size: 0.115 }),
        text(c, 'names', w * 0.1, h * 0.86, w * 0.8, h * 0.05, { color: '@accent' }),
      ];
    },
  }),
  def({
    id: 'arch-window', name: 'Arch Window', description: 'Photo in an elegant arch cutout.',
    kinds: ['front', 'inside'], photos: 1, category: 'cutout', params: ['margin'],
    build: (c) => {
      const { w, h } = c;
      if (isLand(c)) {
        const tx = w * 0.55, tw = w * 0.4;
        return [
          photo(0, { x: w * 0.07, y: h * 0.08, w: w * 0.4, h: h * 0.84 }, { mask: 'arch' }),
          text(c, 'headline', tx, h * 0.24, tw, h * 0.3, { size: 0.12 }),
          text(c, 'subhead', tx, h * 0.56, tw, h * 0.07),
          text(c, 'names', tx, h * 0.67, tw, h * 0.07),
          text(c, 'year', tx, h * 0.75, tw, h * 0.06),
        ];
      }
      const sq = c.orientation === 'square';
      const aw = sq ? w * 0.56 : w * 0.7;
      const ah = sq ? h * 0.56 : h * 0.58;
      return [
        photo(0, { x: (w - aw) / 2, y: h * 0.07, w: aw, h: ah }, { mask: 'arch' }),
        text(c, 'headline', w * 0.08, h * (sq ? 0.65 : 0.67), w * 0.84, h * (sq ? 0.15 : 0.135), { size: 0.11 }),
        text(c, 'subhead', w * 0.1, h * (sq ? 0.8 : 0.805), w * 0.8, h * 0.045),
        text(c, 'names', w * 0.1, h * (sq ? 0.855 : 0.86), w * 0.8, h * 0.045),
      ];
    },
  }),
  def({
    id: 'circle-medallion', name: 'Medallion', description: 'Circular photo framed by a laurel, with a centred greeting.',
    kinds: ['front', 'back', 'inside'], photos: 1, category: 'cutout',
    build: (c) => {
      const { w, h } = c;
      if (isLand(c)) {
        const d = Math.min(h * 0.7, w * 0.42);
        const cx = w * 0.3, cy = h * 0.5;
        const tx = w * 0.56, tw = w * 0.38;
        return [
          orn('laurel', cx - d * 0.66, cy - d * 0.62, d * 1.32, d * 1.32),
          photo(0, { x: cx - d / 2, y: cy - d / 2, w: d, h: d }, { mask: 'circle' }),
          text(c, 'headline', tx, h * 0.24, tw, h * 0.3, { size: 0.12 }),
          text(c, 'subhead', tx, h * 0.56, tw, h * 0.07),
          text(c, 'names', tx, h * 0.67, tw, h * 0.07),
          text(c, 'year', tx, h * 0.75, tw, h * 0.06),
        ];
      }
      const sq = c.orientation === 'square';
      const d = sq ? w * 0.5 : Math.min(w * 0.64, h * 0.46);
      const cx = w / 2, cy = sq ? h * 0.36 : h * 0.35;
      const lb = cy + d * 0.7;
      return [
        orn('laurel', cx - d * 0.66, cy - d * 0.62, d * 1.32, d * 1.32),
        photo(0, { x: cx - d / 2, y: cy - d / 2, w: d, h: d }, { mask: 'circle' }),
        text(c, 'headline', w * 0.08, lb + h * 0.015, w * 0.84, h * (sq ? 0.12 : 0.13), { size: 0.11 }),
        text(c, 'names', w * 0.1, lb + h * (sq ? 0.14 : 0.15), w * 0.8, h * 0.045),
        text(c, 'year', w * 0.1, lb + h * (sq ? 0.185 : 0.195), w * 0.8, h * 0.035),
      ];
    },
  }),
  def({
    id: 'scalloped-edge', name: 'Scalloped', description: 'Sweet scalloped photo cutout — lovely for spring & baby cards.',
    kinds: ['front', 'inside'], photos: 1, category: 'cutout',
    build: (c) => {
      const { w, h } = c;
      if (isLand(c)) {
        const tx = w * 0.56, tw = w * 0.39;
        return [
          photo(0, { x: w * 0.06, y: h * 0.08, w: w * 0.45, h: h * 0.84 }, { mask: 'scallop' }),
          text(c, 'headline', tx, h * 0.24, tw, h * 0.3, { size: 0.12 }),
          text(c, 'subhead', tx, h * 0.56, tw, h * 0.07),
          text(c, 'names', tx, h * 0.67, tw, h * 0.07),
        ];
      }
      return [
        photo(0, { x: w * 0.09, y: h * 0.06, w: w * 0.82, h: h * 0.6 }, { mask: 'scallop' }),
        text(c, 'headline', w * 0.08, h * 0.68, w * 0.84, h * 0.13, { size: 0.11 }),
        text(c, 'subhead', w * 0.1, h * 0.81, w * 0.8, h * 0.045),
        text(c, 'names', w * 0.1, h * 0.865, w * 0.8, h * 0.045),
      ];
    },
  }),
  def({
    id: 'heart-cutout', name: 'Heart Cutout', description: 'Photo inside a heart shape.',
    kinds: ['front', 'inside'], photos: 1, category: 'cutout',
    build: (c) => {
      const { w, h } = c;
      if (isLand(c)) {
        const hh = h * 0.8, hw = hh * 1.08;
        const tx = w * 0.06 + hw + 0.3, tw = w - tx - 0.35;
        return [
          photo(0, { x: w * 0.06, y: h * 0.1, w: hw, h: hh }, { mask: 'heart' }),
          text(c, 'headline', tx, h * 0.24, tw, h * 0.3, { size: 0.12 }),
          text(c, 'subhead', tx, h * 0.56, tw, h * 0.07),
          text(c, 'names', tx, h * 0.67, tw, h * 0.07),
        ];
      }
      const hw = c.orientation === 'square' ? w * 0.56 : w * 0.8;
      const hh = hw * 0.92;
      return [
        photo(0, { x: (w - hw) / 2, y: h * 0.06, w: hw, h: hh }, { mask: 'heart', focusArea: { x: 0.1, y: 0.05, w: 0.8, h: 0.6 } }),
        text(c, 'headline', w * 0.08, h * 0.06 + hh + h * 0.02, w * 0.84, h * 0.14, { size: 0.11 }),
        text(c, 'subhead', w * 0.1, h * 0.06 + hh + h * 0.17, w * 0.8, h * 0.045),
        text(c, 'names', w * 0.1, h * 0.06 + hh + h * 0.225, w * 0.8, h * 0.045),
      ];
    },
  }),
  def({
    id: 'polaroid-single', name: 'Polaroid', description: 'A tilted instant-photo with a handwritten caption.',
    kinds: ['front', 'inside'], photos: 1, category: 'cutout',
    build: (c) => {
      const { w, h } = c;
      if (c.orientation !== 'portrait') {
        const pw = Math.min(w * 0.38, (h * 0.84) / 1.2), ph = pw * 1.2;
        const tx = w * 0.06 + pw + 0.35, tw = w - tx - 0.35;
        return [
          ...polaroid(c, 0, w * 0.07, (h - ph) / 2, pw, ph, -4, 'names'),
          text(c, 'headline', tx, h * 0.26, tw, h * 0.3, { size: 0.12 }),
          text(c, 'subhead', tx, h * 0.58, tw, h * 0.07),
          text(c, 'year', tx, h * 0.68, tw, h * 0.06),
        ];
      }
      const pw = w * 0.78, ph = pw * 1.2;
      return [
        ...polaroid(c, 0, (w - pw) / 2, h * 0.05, pw, ph, -3, 'names'),
        text(c, 'headline', w * 0.08, h * 0.05 + ph + h * 0.03, w * 0.84, h * 0.13, { size: 0.11 }),
        text(c, 'year', w * 0.1, h * 0.05 + ph + h * 0.165, w * 0.8, h * 0.04),
      ];
    },
  }),
  def({
    id: 'polaroid-scrapbook', name: 'Scrapbook', description: 'Three tilted snapshots, scrapbook style.',
    kinds: ['front', 'back', 'inside'], photos: 3, category: 'collage',
    build: (c) => {
      const { w, h } = c;
      if (c.orientation !== 'portrait') {
        const pw = Math.min(w * 0.28, (h * 0.5) / 1.2), ph = pw * 1.2;
        const gap = (w - 3 * pw) / 4;
        return [
          ...polaroid(c, 0, gap, h * 0.07, pw, ph, -5),
          ...polaroid(c, 1, gap * 2 + pw, h * 0.11, pw, ph, 3),
          ...polaroid(c, 2, gap * 3 + pw * 2, h * 0.06, pw, ph, -4),
          text(c, 'headline', w * 0.08, h * 0.07 + ph + h * 0.05, w * 0.84, h * 0.2, { size: 0.12 }),
          text(c, 'names', w * 0.1, h * 0.86, w * 0.8, h * 0.055),
        ];
      }
      const pw = w * 0.46, ph = pw * 1.2;
      return [
        ...polaroid(c, 0, w * 0.07, h * 0.04, pw, ph, -6),
        ...polaroid(c, 1, w * 0.47, h * 0.16, pw, ph, 6),
        ...polaroid(c, 2, w * 0.2, h * 0.39, pw, ph, -2),
        text(c, 'headline', w * 0.08, h * 0.795, w * 0.84, h * 0.1, { size: 0.1 }),
        text(c, 'names', w * 0.1, h * 0.9, w * 0.8, h * 0.04),
      ];
    },
  }),
  def({
    id: 'photo-sandwich', name: 'Photo Sandwich', description: 'Two photos with the greeting tucked between them.',
    kinds: ['front', 'back'], photos: 2, category: 'collage', params: ['margin', 'gutter', 'radius'], defaults: { margin: 0, radius: 0 },
    build: (c) => {
      const { w, h } = c;
      const r = c.params.radius, mask = r > 0 ? ('rounded' as const) : ('rect' as const);
      if (c.orientation === 'portrait') {
        return [
          photo(0, edgeRect(c, 0, 0, w, h * 0.4), { radius: r, mask }),
          text(c, 'headline', w * 0.08, h * 0.415, w * 0.84, h * 0.11, { size: 0.1 }),
          text(c, 'names', w * 0.1, h * 0.53, w * 0.8, h * 0.05),
          photo(1, edgeRect(c, 0, h * 0.6, w, h), { radius: r, mask }),
        ];
      }
      return [
        photo(0, edgeRect(c, 0, 0, w * 0.36, h), { radius: r, mask }),
        text(c, 'headline', w * 0.38, h * 0.25, w * 0.24, h * 0.35, { size: 0.1 }),
        text(c, 'names', w * 0.38, h * 0.62, w * 0.24, h * 0.1),
        photo(1, edgeRect(c, w * 0.64, 0, w, h), { radius: r, mask }),
      ];
    },
  }),
  def({
    id: 'collage-3-hero', name: 'Hero Trio', description: 'One large hero photo plus two supporting shots.',
    kinds: ['front', 'back'], photos: 3, category: 'collage', params: ['gutter', 'margin', 'radius'], defaults: { margin: 0 },
    build: (c) => {
      const { w, h } = c;
      const g = c.params.gutter;
      const r = c.params.radius, mask = r > 0 ? ('rounded' as const) : ('rect' as const);
      if (isLand(c)) {
        const sx = w * 0.6;
        return [
          photo(0, edgeRect(c, 0, 0, sx - g / 2, h), { radius: r, mask }),
          ...grid(c, sx + g / 2, 0, w, h * 0.62, 1, 2, 1),
          text(c, 'headline', sx + 0.15, h * 0.64, w - sx - 0.4, h * 0.2, { size: 0.09 }),
          text(c, 'names', sx + 0.15, h * 0.85, w - sx - 0.4, h * 0.06),
        ];
      }
      return [
        photo(0, edgeRect(c, 0, 0, w, h * 0.52 - g / 2), { radius: r, mask }),
        ...grid(c, 0, h * 0.52 + g / 2, w, h * 0.8, 2, 1, 1),
        text(c, 'headline', w * 0.08, h * 0.81, w * 0.84, h * 0.1, { size: 0.09 }),
        text(c, 'names', w * 0.1, h * 0.905, w * 0.8, h * 0.04),
      ];
    },
  }),
  def({
    id: 'collage-4-grid', name: 'Four Square', description: 'Four photos in a grid with a centred greeting badge.',
    kinds: ['front', 'back'], photos: 4, category: 'collage', params: ['gutter', 'margin', 'radius'], defaults: { margin: 0, gutter: 0.1 },
    build: (c) => {
      const { w, h } = c;
      const d = Math.min(w, h) * 0.46;
      const cx = w / 2, cy = h / 2;
      return [
        ...grid(c, 0, 0, w, h, 2, 2, 0, { focusArea: { x: 0.1, y: 0, w: 0.8, h: 0.75 } }),
        shape({ x: cx - d / 2, y: cy - d / 2, w: d, h: d }, { shape: 'ellipse', fill: '@background' }),
        shape({ x: cx - d * 0.45, y: cy - d * 0.45, w: d * 0.9, h: d * 0.9 }, { shape: 'ellipse', fill: null, stroke: { width: 0.015, color: '@accent' } }),
        text(c, 'headline', cx - d * 0.38, cy - d * 0.25, d * 0.76, d * 0.36, { size: 0.075 }),
        text(c, 'names', cx - d * 0.34, cy + d * 0.13, d * 0.68, d * 0.12, { size: 0.026 }),
      ];
    },
  }),
  def({
    id: 'collage-5-mosaic', name: 'Mosaic Five', description: 'A hero photo with four smaller moments.',
    kinds: ['front', 'back'], photos: 5, category: 'collage', params: ['gutter', 'margin', 'radius'], defaults: { margin: 0 },
    build: (c) => {
      const { w, h, bleed: b } = c;
      const g = c.params.gutter;
      const r = c.params.radius, mask = r > 0 ? ('rounded' as const) : ('rect' as const);
      if (isLand(c)) {
        const sx = w * 0.5;
        return [
          photo(0, edgeRect(c, 0, 0, sx - g / 2, h), { radius: r, mask, focusArea: { x: 0, y: 0, w: 1, h: 0.62 } }),
          scrim({ x: -b, y: h * 0.6, w: sx - g / 2 + b, h: h * 0.4 + b }, { direction: 'to-top', strength: 0.6, extent: 0.4 }),
          text(c, 'headline', 0.3, h * 0.66, sx - 0.6, h * 0.17, { color: '@onPhoto', size: 0.1, shadow: true }),
          text(c, 'names', 0.3, h * 0.84, sx - 0.6, h * 0.06, { color: '@onPhoto' }),
          ...grid(c, sx + g / 2, 0, w, h, 2, 2, 1),
        ];
      }
      return [
        photo(0, edgeRect(c, 0, 0, w, h * 0.46 - g / 2), { radius: r, mask }),
        ...grid(c, 0, h * 0.46 + g / 2, w, h * 0.8, 2, 2, 1),
        text(c, 'headline', w * 0.08, h * 0.81, w * 0.84, h * 0.095, { size: 0.085 }),
        text(c, 'names', w * 0.1, h * 0.902, w * 0.8, h * 0.04),
      ];
    },
  }),
  def({
    id: 'collage-6-grid', name: 'Six Grid', description: 'Six photos in a tidy grid — a year in pictures.',
    kinds: ['front', 'back'], photos: 6, category: 'collage', params: ['gutter', 'margin', 'radius'], defaults: { margin: 0 },
    build: (c) => {
      const { w, h } = c;
      if (c.orientation === 'portrait') {
        return [
          ...grid(c, 0, 0, w, h * 0.8, 2, 3, 0),
          text(c, 'headline', w * 0.08, h * 0.81, w * 0.84, h * 0.095, { size: 0.085 }),
          text(c, 'names', w * 0.1, h * 0.902, w * 0.8, h * 0.04),
        ];
      }
      return [
        ...grid(c, 0, 0, w, h * 0.77, 3, 2, 0),
        text(c, 'headline', w * 0.08, h * 0.78, w * 0.84, h * 0.11, { size: 0.08 }),
        text(c, 'names', w * 0.1, h * 0.89, w * 0.8, h * 0.05),
      ];
    },
  }),
  def({
    id: 'filmstrip', name: 'Filmstrip', description: 'Three cinematic strips with the greeting below.',
    kinds: ['front', 'back'], photos: 3, category: 'collage', params: ['gutter', 'margin', 'radius'], defaults: { margin: 0.28, gutter: 0.1 },
    build: (c) => {
      const { w, h } = c;
      if (c.orientation === 'portrait') {
        return [
          ...grid(c, 0, 0, w, h * 0.77, 1, 3, 0),
          text(c, 'headline', w * 0.08, h * 0.785, w * 0.84, h * 0.105, { size: 0.09 }),
          text(c, 'names', w * 0.1, h * 0.892, w * 0.8, h * 0.04),
        ];
      }
      return [
        ...grid(c, 0, 0, w, h * 0.74, 3, 1, 0),
        text(c, 'headline', w * 0.08, h * 0.755, w * 0.84, h * 0.12, { size: 0.085 }),
        text(c, 'names', w * 0.1, h * 0.88, w * 0.8, h * 0.055),
      ];
    },
  }),
  def({
    id: 'minimal-type', name: 'Typography Only', description: 'No photo — an elegant ornament and greeting.',
    kinds: ['front', 'back', 'inside'], photos: 0, category: 'typography',
    build: (c) => {
      const { w, h } = c;
      const iu = c.unit * 0.24;
      return [
        orn('@icon', w / 2 - iu / 2, h * 0.12, iu, iu),
        text(c, 'headline', w * 0.08, h * 0.12 + iu + h * 0.03, w * 0.84, h * 0.22, { size: 0.15 }),
        orn('divider-diamond', w * 0.25, h * 0.6, w * 0.5, w * 0.05, { color: '@accent' }),
        text(c, 'message', w * 0.12, h * 0.65, w * 0.76, h * 0.14),
        text(c, 'names', w * 0.1, h * 0.81, w * 0.8, h * 0.05),
      ];
    },
  }),
  /* ----------------------------- Backs --------------------------------- */
  def({
    id: 'back-letter', name: 'Family Letter', description: 'A year-in-review letter with a handwritten signature.',
    kinds: ['back', 'inside'], photos: 0, category: 'letter', params: ['margin'], defaults: { margin: 0.45 },
    build: (c) => {
      const { w, h } = c;
      const m = Math.max(0.3, c.params.margin);
      return [
        text(c, 'headline', m, h * 0.05, w - 2 * m, h * 0.09, { size: 0.075 }),
        orn('divider-diamond', w * 0.3, h * 0.145, w * 0.4, w * 0.04, { color: '@accent' }),
        text(c, 'body', m, h * 0.19, w - 2 * m, h * 0.62),
        text(c, 'names', m, h * 0.82, w - 2 * m, h * 0.07, { fontRole: 'display', size: 0.065, transform: 'none' }),
        text(c, 'year', m, h * 0.9, w - 2 * m, h * 0.035),
      ];
    },
  }),
  def({
    id: 'back-collage-note', name: 'Photos + Note', description: 'Three more photos and a short note.',
    kinds: ['back', 'inside'], photos: 3, category: 'collage', params: ['gutter', 'radius', 'margin'], defaults: { margin: 0.3, radius: 0.06 },
    build: (c) => {
      const { w, h } = c;
      const m = Math.max(0.15, c.params.margin);
      const cw = (w - 2 * m - 2 * c.params.gutter) / 3;
      const rowH = Math.min(cw * 1.25, h * 0.36);
      const iu = c.unit * 0.09;
      return [
        ...grid(c, m, m, w - m, m + rowH, 3, 1, 0),
        text(c, 'message', w * 0.1, m + rowH + h * 0.05, w * 0.8, h * 0.28),
        text(c, 'names', w * 0.1, m + rowH + h * 0.35, w * 0.8, h * 0.06, { fontRole: 'display', size: 0.06, transform: 'none' }),
        text(c, 'year', w * 0.1, m + rowH + h * 0.42, w * 0.8, h * 0.04),
        orn('@icon', w / 2 - iu / 2, Math.min(h - 0.35 - iu, m + rowH + h * 0.48), iu, iu),
      ];
    },
  }),
  def({
    id: 'back-photo-note', name: 'Photo + Message', description: 'One more favourite photo with a message.',
    kinds: ['back', 'inside'], photos: 1, category: 'split',
    build: (c) => {
      const { w, h, bleed: b } = c;
      if (isLand(c)) {
        return [
          photo(0, { x: -b, y: -b, w: w * 0.5 + b, h: h + 2 * b }),
          text(c, 'message', w * 0.56, h * 0.22, w * 0.38, h * 0.38),
          text(c, 'names', w * 0.56, h * 0.64, w * 0.38, h * 0.1, { fontRole: 'display', size: 0.07, transform: 'none' }),
          text(c, 'year', w * 0.56, h * 0.76, w * 0.38, h * 0.06),
        ];
      }
      return [
        photo(0, { x: -b, y: -b, w: w + 2 * b, h: h * 0.55 + b }),
        text(c, 'message', w * 0.1, h * 0.6, w * 0.8, h * 0.19),
        text(c, 'names', w * 0.1, h * 0.8, w * 0.8, h * 0.07, { fontRole: 'display', size: 0.065, transform: 'none' }),
        text(c, 'year', w * 0.1, h * 0.88, w * 0.8, h * 0.04),
      ];
    },
  }),
  def({
    id: 'back-monogram', name: 'Monogram', description: 'A minimalist monogram and year.',
    kinds: ['back', 'inside'], photos: 0, category: 'typography',
    build: (c) => {
      const { w, h } = c;
      const d = c.unit * 0.5;
      const cy = h * 0.4;
      return [
        orn('laurel', w / 2 - d / 2, cy - d / 2, d, d),
        text(c, 'monogram', w / 2 - d * 0.35, cy - d * 0.32, d * 0.7, d * 0.6, { size: 0.24 }),
        text(c, 'names', w * 0.1, cy + d * 0.6, w * 0.8, h * 0.05),
        text(c, 'year', w * 0.1, cy + d * 0.6 + h * 0.06, w * 0.8, h * 0.04),
      ];
    },
  }),
  def({
    id: 'back-postcard', name: 'Postcard Back', description: 'Message, return address, stamp box and address lines.',
    kinds: ['back'], photos: 0, category: 'postcard',
    build: (c) => {
      const { w, h } = c;
      const m = 0.35;
      const line = (x: number, y: number, len: number) => shape({ x, y, w: len, h: 0.012 }, { fill: '@textMuted' });
      if (c.orientation !== 'portrait') {
        const dx = w * 0.52;
        return [
          text(c, 'small', m, m, dx - m - 0.2, h * 0.16),
          text(c, 'message', m, m + h * 0.2, dx - m - 0.25, h * 0.6, { align: 'left', vAlign: 'top', size: 0.04 }),
          shape({ x: dx, y: m, w: 0.012, h: h - 2 * m }, { fill: '@textMuted' }),
          shape({ x: w - m - 0.78, y: m, w: 0.78, h: 0.92 }, { fill: null, stroke: { width: 0.012, color: '@textMuted' } }),
          line(dx + 0.25, h * 0.52, w - dx - 0.25 - m),
          line(dx + 0.25, h * 0.64, w - dx - 0.25 - m),
          line(dx + 0.25, h * 0.76, w - dx - 0.25 - m),
        ];
      }
      const dy = h * 0.5;
      return [
        text(c, 'message', m, m, w - 2 * m, dy - m - 0.2, { align: 'left', vAlign: 'top', size: 0.042 }),
        shape({ x: m, y: dy, w: w - 2 * m, h: 0.012 }, { fill: '@textMuted' }),
        text(c, 'small', m, dy + 0.2, w * 0.55, h * 0.12),
        shape({ x: w - m - 0.78, y: dy + 0.2, w: 0.78, h: 0.92 }, { fill: null, stroke: { width: 0.012, color: '@textMuted' } }),
        line(w * 0.3, h * 0.74, w * 0.7 - m),
        line(w * 0.3, h * 0.81, w * 0.7 - m),
        line(w * 0.3, h * 0.88, w * 0.7 - m),
      ];
    },
  }),
  /* ----------------------------- Inside -------------------------------- */
  def({
    id: 'inside-message', name: 'Inside Message', description: 'A centred greeting and signature.',
    kinds: ['inside', 'back'], photos: 0, category: 'typography',
    build: (c) => {
      const { w, h } = c;
      const iu = c.unit * 0.12;
      return [
        orn('@icon', w / 2 - iu / 2, h * 0.16, iu, iu),
        text(c, 'message', w * 0.12, h * 0.3, w * 0.76, h * 0.3, { size: 0.045 }),
        text(c, 'names', w * 0.1, h * 0.63, w * 0.8, h * 0.09, { fontRole: 'display', size: 0.075, transform: 'none' }),
      ];
    },
  }),
  def({
    id: 'inside-quote', name: 'Quote', description: 'A short quote or verse, nothing else.',
    kinds: ['inside'], photos: 0, category: 'typography',
    build: (c) => {
      const { w, h } = c;
      return [
        orn('flourish', w * 0.2, h * 0.3, w * 0.6, w * 0.12, { color: '@accent' }),
        text(c, 'message', w * 0.14, h * 0.4, w * 0.72, h * 0.22, { size: 0.042, italic: true }),
        orn('flourish', w * 0.2, h * 0.64, w * 0.6, w * 0.12, { color: '@accent', flipX: true }),
      ];
    },
  }),
];

export function getBuiltinTemplate(id: string) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

export { text as templateText, grid as templateGrid, edgeRect as templateEdgeRect, ROLE_DEFAULTS };
