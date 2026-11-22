/**
 * Pattern & Paper Studio: procedural vector backdrops.
 *
 * Every backdrop is plain SVG geometry (paths, rects, gradients) generated from a seed, so it is
 * resolution-independent: it prints as crisp vector art at 300, 600 or any DPI, works offline, and
 * the editor preview and the print renderer draw exactly the same picture.
 *
 * Rules that keep it print-safe in Chromium's PDF output:
 *   - no SVG filters, masks or <pattern> fills (Chromium rasterises those in PDFs);
 *   - many shapes are merged into a few <path> elements so pages stay light;
 *   - colours are theme tokens ("@accent"), so a backdrop follows Color Harmony automatically.
 *     Every resolved colour is checked to be a hex colour before it's written into markup.
 *
 * Units: the viewBox uses hundredths of an inch and covers the full bleed area. The trim box
 * starts at (bleed, bleed). Frames and borders are positioned against the trim box.
 */
import { isHexColor, mixHex, resolveColor } from './color';
import { prng } from './harmony';
import type { BackdropKind, BackdropSpec, ColorRef, Theme } from './types';

export interface BackdropBox {
  widthIn: number;
  heightIn: number;
  bleedIn: number;
}

export interface BackdropDef {
  kind: BackdropKind;
  name: string;
  description: string;
  /** Default settings (seed excluded). */
  defaults: Omit<BackdropSpec, 'kind' | 'seed'>;
  /** Which settings the studio shows sliders for. */
  controls: Array<'density' | 'scale' | 'opacity'>;
  tags: string[];
}

export const BACKDROPS: BackdropDef[] = [
  {
    kind: 'cardstock',
    name: 'Textured cardstock',
    description: 'Fine fibres and flecks, like heavy uncoated paper.',
    defaults: { density: 0.55, scale: 1, opacity: 0.55, colors: { primary: '@textMuted', secondary: '@accent' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['paper', 'texture', 'neutral'],
  },
  {
    kind: 'linen',
    name: 'Linen grain',
    description: 'Woven crosshatch threads of a linen finish.',
    defaults: { density: 0.6, scale: 1, opacity: 0.45, colors: { primary: '@textMuted', secondary: '@text' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['paper', 'texture', 'neutral'],
  },
  {
    kind: 'watercolor',
    name: 'Watercolor wash',
    description: 'Soft layered washes of colour bleeding in from the edges.',
    defaults: { density: 0.5, scale: 1, opacity: 0.8, colors: { primary: '@accent', secondary: '@accent2', tertiary: '@surface' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['painterly', 'soft', 'any season'],
  },
  {
    kind: 'snowfall',
    name: 'Falling snow',
    description: 'Gently falling snow, from fine flurries to big flakes.',
    defaults: { density: 0.5, scale: 1, opacity: 0.85, colors: { primary: '#ffffff', secondary: '@surface' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['winter', 'christmas', 'holiday'],
  },
  {
    kind: 'stars',
    name: 'Twinkling stars',
    description: 'Four-point sparkles and tiny stars scattered across the sky.',
    defaults: { density: 0.45, scale: 1, opacity: 0.9, colors: { primary: '@accent', secondary: '#ffffff' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['night', 'new year', 'christmas', 'hanukkah'],
  },
  {
    kind: 'plaid',
    name: 'Festive plaid',
    description: 'A woven tartan of overlapping bands and pinstripes.',
    defaults: { density: 0.5, scale: 1, opacity: 0.55, colors: { primary: '@accent', secondary: '@accent2', tertiary: '@surface' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['christmas', 'cozy', 'winter'],
  },
  {
    kind: 'deco-border',
    name: 'Art Deco gold border',
    description: 'Geometric gold-foil border with fan corners.',
    defaults: { density: 0.5, scale: 1, opacity: 1, colors: { primary: '#c9a24a', secondary: '@accent' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['elegant', 'new year', 'wedding', 'gold'],
  },
  {
    kind: 'scallop-frame',
    name: 'Scalloped frame',
    description: 'A minimalist scalloped edge framing the card.',
    defaults: { density: 0.5, scale: 1, opacity: 1, colors: { primary: '@accent', secondary: '@surface' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['minimal', 'baby', 'spring', 'any season'],
  },
  {
    kind: 'radial-glow',
    name: 'Radial holiday glow',
    description: 'A warm glow of light with soft bokeh circles.',
    defaults: { density: 0.45, scale: 1, opacity: 0.85, colors: { primary: '@accent', secondary: '@accent2', tertiary: '#ffffff' } },
    controls: ['density', 'scale', 'opacity'],
    tags: ['holiday', 'warm', 'night'],
  },
];

const KINDS = new Set(BACKDROPS.map((b) => b.kind));
export const backdropDef = (kind: BackdropKind) => BACKDROPS.find((b) => b.kind === kind) ?? BACKDROPS[0];

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const TOKEN_RE = /^@(background|surface|text|textMuted|accent|accent2|onPhoto|scrim)$/;
const validRef = (r: unknown, d: ColorRef): ColorRef => (typeof r === 'string' && (TOKEN_RE.test(r) || isHexColor(r)) ? r : d);

export function newBackdrop(kind: BackdropKind, seed = Math.floor(Math.random() * 1e9)): BackdropSpec {
  const d = backdropDef(kind);
  return { kind: d.kind, seed, ...structuredClone(d.defaults) };
}

/** Validate/clamp a backdrop read from a project file (untrusted: may come from a shared copy). */
export function sanitizeBackdrop(input: unknown): BackdropSpec | null {
  if (!input || typeof input !== 'object') return null;
  const b = input as Partial<BackdropSpec>;
  if (!b.kind || !KINDS.has(b.kind)) return null;
  const d = backdropDef(b.kind);
  const c = (b.colors ?? {}) as Partial<BackdropSpec['colors']>;
  return {
    kind: b.kind,
    seed: Math.floor(clamp(b.seed, 0, 2 ** 31 - 1, 1)),
    density: clamp(b.density, 0, 1, d.defaults.density),
    scale: clamp(b.scale, 0.5, 2, d.defaults.scale),
    opacity: clamp(b.opacity, 0, 1, d.defaults.opacity),
    colors: {
      primary: validRef(c.primary, d.defaults.colors.primary),
      secondary: validRef(c.secondary, d.defaults.colors.secondary),
      ...(c.tertiary || d.defaults.colors.tertiary ? { tertiary: validRef(c.tertiary, d.defaults.colors.tertiary ?? d.defaults.colors.secondary) } : {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const U = 100; // viewBox units per inch
const f = (v: number) => (Math.round(v * 100) / 100).toString();
const safeHex = (hex: string, fallback: string) => (isHexColor(hex) ? hex.slice(0, 7) : fallback);
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'hcbd';

/** Gaussian-ish random (sum of uniforms). */
const gauss = (r: () => number) => (r() + r() + r() + r() - 2) / 2;

function circlePath(cx: number, cy: number, rad: number) {
  return `M${f(cx - rad)} ${f(cy)}a${f(rad)} ${f(rad)} 0 1 0 ${f(rad * 2)} 0a${f(rad)} ${f(rad)} 0 1 0 ${f(-rad * 2)} 0Z`;
}

function polyPath(pts: Array<[number, number]>) {
  if (!pts.length) return '';
  return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/** Collect sub-paths into a few opacity buckets so the SVG stays light. */
class Buckets {
  private b = new Map<string, string[]>();
  add(key: string, d: string) {
    const list = this.b.get(key);
    if (list) list.push(d);
    else this.b.set(key, [d]);
  }
  render(attrs: (key: string) => string) {
    return [...this.b.entries()].map(([k, ds]) => `<path ${attrs(k)} d="${ds.join('')}"/>`).join('');
  }
}

interface Ctx {
  r: () => number;
  W: number;
  H: number;
  /** Trim box in viewBox units. */
  tx: number;
  ty: number;
  tw: number;
  th: number;
  spec: BackdropSpec;
  c1: string;
  c2: string;
  c3: string;
  id: string;
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

function cardstock(x: Ctx) {
  const { r, W, H, spec } = x;
  const area = (W / U) * (H / U);
  const fibres = Math.round(area * (40 + spec.density * 160));
  const flecks = Math.round(area * (10 + spec.density * 50));
  const out = new Buckets();
  for (let i = 0; i < fibres; i++) {
    const cx = r() * W;
    const cy = r() * H;
    const len = (1.2 + r() * 3.5) * spec.scale;
    const a = r() * Math.PI;
    const bend = (r() - 0.5) * len * 0.8;
    const dx = Math.cos(a) * len;
    const dy = Math.sin(a) * len;
    const op = r() < 0.7 ? 'a' : 'b';
    out.add(`f${op}`, `M${f(cx - dx / 2)} ${f(cy - dy / 2)}q${f(dx / 2 - dy * 0.2 + bend * 0.1)} ${f(dy / 2 + dx * 0.2)} ${f(dx)} ${f(dy)}`);
  }
  for (let i = 0; i < flecks; i++) {
    const rad = (0.12 + r() ** 2 * 0.45) * spec.scale;
    out.add(r() < 0.75 ? 'ka' : 'kb', circlePath(r() * W, r() * H, rad));
  }
  return out.render((k) => {
    if (k === 'fa') return `fill="none" stroke="${x.c1}" stroke-opacity="0.22" stroke-width="${f(0.11 * spec.scale)}" stroke-linecap="round"`;
    if (k === 'fb') return `fill="none" stroke="${x.c1}" stroke-opacity="0.4" stroke-width="${f(0.08 * spec.scale)}" stroke-linecap="round"`;
    if (k === 'ka') return `fill="${x.c1}" fill-opacity="0.35"`;
    return `fill="${x.c2}" fill-opacity="0.45"`;
  });
}

function linen(x: Ctx) {
  const { r, W, H, spec } = x;
  const pitch = (1.6 - spec.density * 0.8) * spec.scale; // centi-inch between threads
  const out = new Buckets();
  const band = (horizontal: boolean) => {
    const span = horizontal ? H : W;
    const length = horizontal ? W : H;
    for (let p = r() * pitch; p < span; p += pitch * (0.7 + r() * 0.6)) {
      const thick = (0.18 + r() * 0.35) * spec.scale;
      const lvl = r();
      const key = `${horizontal ? 'h' : 'v'}${lvl < 0.45 ? 1 : lvl < 0.8 ? 2 : 3}`;
      // Each thread drifts slightly and breaks into slubs.
      let s = 0;
      while (s < length) {
        const seg = (20 + r() * 120) * spec.scale;
        const e = Math.min(length, s + seg);
        const w = thick * (0.7 + r() * 0.6);
        const off = p + gauss(r) * 0.15;
        out.add(key, horizontal ? `M${f(s)} ${f(off)}H${f(e)}v${f(w)}H${f(s)}Z` : `M${f(off)} ${f(s)}V${f(e)}h${f(w)}V${f(s)}Z`);
        s = e + r() * 3 * spec.scale;
      }
    }
  };
  band(true);
  band(false);
  return out.render((k) => {
    const level = Number(k.slice(1));
    const col = k[0] === 'h' ? x.c1 : x.c2;
    return `fill="${col}" fill-opacity="${[0, 0.07, 0.13, 0.22][level]}"`;
  });
}

/** Tyler Hobbs-style watercolour: a polygon recursively deformed, stacked at low opacity. */
function deform(pts: Array<[number, number]>, depth: number, variance: number, r: () => number): Array<[number, number]> {
  let cur = pts;
  for (let d = 0; d < depth; d++) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push(a);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2 + gauss(r) * len * variance;
      const my = (a[1] + b[1]) / 2 + gauss(r) * len * variance;
      next.push([mx, my]);
    }
    cur = next;
  }
  return cur;
}

function watercolor(x: Ctx) {
  const { r, W, H, spec } = x;
  const blobs = 2 + Math.round(spec.density * 3);
  const layers = 14;
  const colors = [x.c1, x.c2, x.c3];
  // Anchor washes towards corners and edges, leaving the middle for photos and text.
  const anchors: Array<[number, number]> = [
    [0.08, 0.1],
    [0.92, 0.9],
    [0.95, 0.12],
    [0.05, 0.88],
    [0.5, 0.02],
  ];
  let out = '';
  for (let bI = 0; bI < blobs; bI++) {
    const [ax, ay] = anchors[bI % anchors.length];
    const cx = (ax + gauss(r) * 0.08) * W;
    const cy = (ay + gauss(r) * 0.08) * H;
    const rad = Math.min(W, H) * (0.28 + r() * 0.18) * spec.scale;
    const base: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      const rr = rad * (0.75 + r() * 0.4);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    });
    const shaped = deform(base, 2, 0.35, r);
    const col = colors[bI % colors.length];
    const paths: string[] = [];
    for (let l = 0; l < layers; l++) paths.push(polyPath(deform(shaped, 3, 0.22, r)));
    // Separate <path>s so each layer's opacity accumulates (that's the wash look).
    out += paths.map((d) => `<path fill="${col}" fill-opacity="0.05" d="${d}"/>`).join('');
  }
  return out;
}

function snowflake(cx: number, cy: number, size: number, rot: number) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    const ex = cx + Math.cos(a) * size;
    const ey = cy + Math.sin(a) * size;
    d += `M${f(cx)} ${f(cy)}L${f(ex)} ${f(ey)}`;
    // little branches two-thirds of the way out
    const bx = cx + Math.cos(a) * size * 0.6;
    const by = cy + Math.sin(a) * size * 0.6;
    for (const s of [-1, 1]) {
      const ba = a + (s * Math.PI) / 4;
      d += `M${f(bx)} ${f(by)}l${f(Math.cos(ba) * size * 0.3)} ${f(Math.sin(ba) * size * 0.3)}`;
    }
  }
  return d;
}

function snowfall(x: Ctx) {
  const { r, W, H, spec } = x;
  const area = (W / U) * (H / U);
  const dots = Math.round(area * (6 + spec.density * 26));
  const flakes = Math.round(area * spec.density * 1.2);
  const out = new Buckets();
  for (let i = 0; i < dots; i++) {
    const t = r();
    const rad = (t < 0.6 ? 0.6 + r() * 0.8 : t < 0.9 ? 1.4 + r() * 1.4 : 2.8 + r() * 2.4) * spec.scale;
    out.add(t < 0.6 ? 's' : t < 0.9 ? 'm' : 'l', circlePath(r() * W, r() * H, rad));
  }
  let flakePaths = '';
  for (let i = 0; i < flakes; i++) flakePaths += snowflake(r() * W, r() * H, (3 + r() * 5) * spec.scale, r() * Math.PI);
  return (
    out.render((k) => `fill="${k === 'l' ? x.c2 : x.c1}" fill-opacity="${k === 's' ? 0.55 : k === 'm' ? 0.75 : 0.5}"`) +
    (flakePaths ? `<path fill="none" stroke="${x.c1}" stroke-opacity="0.8" stroke-width="${f(0.35 * spec.scale)}" stroke-linecap="round" d="${flakePaths}"/>` : '')
  );
}

function sparkle(cx: number, cy: number, s: number) {
  const k = s * 0.18; // waist of the four-point star
  return `M${f(cx)} ${f(cy - s)}Q${f(cx + k)} ${f(cy - k)} ${f(cx + s)} ${f(cy)}Q${f(cx + k)} ${f(cy + k)} ${f(cx)} ${f(cy + s)}Q${f(cx - k)} ${f(cy + k)} ${f(cx - s)} ${f(cy)}Q${f(cx - k)} ${f(cy - k)} ${f(cx)} ${f(cy - s)}Z`;
}

function stars(x: Ctx) {
  const { r, W, H, spec } = x;
  const area = (W / U) * (H / U);
  const tiny = Math.round(area * (8 + spec.density * 30));
  const big = Math.round(area * (0.6 + spec.density * 2.4));
  const out = new Buckets();
  for (let i = 0; i < tiny; i++) out.add(r() < 0.5 ? 'ta' : 'tb', circlePath(r() * W, r() * H, (0.25 + r() * 0.55) * spec.scale));
  for (let i = 0; i < big; i++) {
    const s = (1.8 + r() ** 2 * 5.5) * spec.scale;
    out.add(r() < 0.65 ? 'sa' : 'sb', sparkle(r() * W, r() * H, s));
  }
  return out.render((k) => {
    if (k === 'ta') return `fill="${x.c2}" fill-opacity="0.55"`;
    if (k === 'tb') return `fill="${x.c1}" fill-opacity="0.7"`;
    if (k === 'sa') return `fill="${x.c1}" fill-opacity="0.95"`;
    return `fill="${x.c2}" fill-opacity="0.9"`;
  });
}

function plaid(x: Ctx) {
  const { r, W, H, spec } = x;
  const sett = (90 + (1 - spec.density) * 80) * spec.scale; // repeat size
  // A symmetric thread-count, mirrored like real tartans.
  // The seed varies the thread count (stripe widths) and where the sett starts.
  const jitter = () => 0.7 + r() * 0.6;
  const stripes: Array<{ w: number; c: 1 | 2 | 3; op: number }> = [
    { w: 0.32 * jitter(), c: 1, op: 0.55 },
    { w: 0.06 * jitter(), c: 3, op: 0.7 },
    { w: 0.14 * jitter(), c: 2, op: 0.45 },
    { w: 0.02 * jitter(), c: 3, op: 0.85 },
    { w: 0.12 * jitter(), c: 1, op: 0.3 },
  ];
  const colors = { 1: x.c1, 2: x.c2, 3: x.c3 } as const;
  let out = '';
  for (const dir of ['h', 'v'] as const) {
    const span = dir === 'h' ? H : W;
    for (let base = -sett * (1 + r()); base < span + sett; base += sett) {
      let p = base;
      const seq = [...stripes, ...[...stripes].reverse()];
      for (const s of seq) {
        const w = s.w * sett * 0.5;
        const op = s.op * (dir === 'v' ? 0.85 : 1);
        if (dir === 'h') out += `<rect x="0" y="${f(p)}" width="${f(W)}" height="${f(w)}" fill="${colors[s.c]}" fill-opacity="${op}"/>`;
        else out += `<rect x="${f(p)}" y="0" width="${f(w)}" height="${f(H)}" fill="${colors[s.c]}" fill-opacity="${op}"/>`;
        p += w + sett * 0.02;
      }
    }
  }
  // Twill hint: fine diagonal hatching over everything.
  let hatch = '';
  const step = 1.1 * spec.scale;
  for (let d = -H; d < W; d += step) hatch += `M${f(d)} ${f(H)}L${f(d + H)} 0`;
  return out + `<path fill="none" stroke="${x.c3}" stroke-opacity="0.08" stroke-width="${f(0.25 * spec.scale)}" d="${hatch}"/>`;
}

function decoBorder(x: Ctx) {
  const { tx, ty, tw, th, spec, id } = x;
  const inset = (16 + (1 - spec.density) * 10) * spec.scale;
  const gap = 4 * spec.scale;
  const sw = 1.1 * spec.scale;
  const L = tx + inset;
  const T = ty + inset;
  const R = tx + tw - inset;
  const B = ty + th - inset;
  const gold = x.c1;
  const light = mixHex(gold, '#ffffff', 0.45);
  const dark = mixHex(gold, '#000000', 0.3);
  const grad = `${id}-foil`;
  const defs = `<defs><linearGradient id="${grad}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="0.3" stop-color="${light}"/><stop offset="0.5" stop-color="${gold}"/><stop offset="0.72" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>`;
  const stroke = `fill="none" stroke="url(#${grad})" stroke-linejoin="miter"`;
  // Double frame with stepped (cut) corners.
  const cut = 10 * spec.scale;
  const stepped = (l: number, t: number, r: number, b: number, c: number) =>
    `M${f(l + c)} ${f(t)}H${f(r - c)}V${f(t + c)}H${f(r)}V${f(b - c)}H${f(r - c)}V${f(b)}H${f(l + c)}V${f(b - c)}H${f(l)}V${f(t + c)}H${f(l + c)}Z`;
  let d = stepped(L, T, R, B, cut) + stepped(L + gap, T + gap, R - gap, B - gap, cut);
  // Fan corners: quarter-circle sunbursts.
  const fanR = (18 + spec.density * 14) * spec.scale;
  const rays = 7;
  const fan = (cx: number, cy: number, a0: number) => {
    let s = '';
    for (let i = 0; i <= rays; i++) {
      const a = a0 + (i / rays) * (Math.PI / 2);
      s += `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a) * fanR)} ${f(cy + Math.sin(a) * fanR)}`;
    }
    for (const k of [0.55, 0.8, 1]) {
      const rr = fanR * k;
      const sx = cx + Math.cos(a0) * rr;
      const sy = cy + Math.sin(a0) * rr;
      const ex = cx + Math.cos(a0 + Math.PI / 2) * rr;
      const ey = cy + Math.sin(a0 + Math.PI / 2) * rr;
      s += `M${f(sx)} ${f(sy)}A${f(rr)} ${f(rr)} 0 0 1 ${f(ex)} ${f(ey)}`;
    }
    return s;
  };
  const g2 = gap * 2;
  d += fan(L + g2, T + g2, 0) + fan(R - g2, T + g2, Math.PI / 2) + fan(R - g2, B - g2, Math.PI) + fan(L + g2, B - g2, (3 * Math.PI) / 2);
  // Centre chevrons on the long edges.
  const chev = (cx: number, cy: number, dir: 1 | -1) => {
    let s = '';
    for (let i = 0; i < 3; i++) {
      const o = i * 3 * spec.scale;
      s += `M${f(cx - 9 * spec.scale + o)} ${f(cy)}L${f(cx)} ${f(cy + dir * (7 * spec.scale - o * 0.6))}L${f(cx + 9 * spec.scale - o)} ${f(cy)}`;
    }
    return s;
  };
  d += chev((L + R) / 2, T + gap, 1) + chev((L + R) / 2, B - gap, -1);
  const accentDiamonds = [
    [(L + R) / 2, T - 0.5 * gap],
    [(L + R) / 2, B + 0.5 * gap],
  ]
    .map(([cx, cy]) => `M${f(cx)} ${f(cy - 3 * spec.scale)}l${f(3 * spec.scale)} ${f(3 * spec.scale)}l${f(-3 * spec.scale)} ${f(3 * spec.scale)}l${f(-3 * spec.scale)} ${f(-3 * spec.scale)}Z`)
    .join('');
  return `${defs}<path ${stroke} stroke-width="${f(sw)}" d="${d}"/><path fill="url(#${grad})" d="${accentDiamonds}"/>`;
}

function scallopFrame(x: Ctx) {
  const { tx, ty, tw, th, spec } = x;
  const inset = (14 + (1 - spec.density) * 8) * spec.scale;
  const L = tx + inset;
  const T = ty + inset;
  const R = tx + tw - inset;
  const B = ty + th - inset;
  const target = (7 + (1 - spec.density) * 6) * spec.scale; // scallop width
  const edge = (from: [number, number], to: [number, number], outward: [number, number]) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.max(2, Math.round(len / target));
    const ux = (to[0] - from[0]) / n;
    const uy = (to[1] - from[1]) / n;
    const rr = Math.hypot(ux, uy) / 2;
    let s = '';
    for (let i = 0; i < n; i++) {
      const ex = from[0] + ux * (i + 1);
      const ey = from[1] + uy * (i + 1);
      // sweep chosen so the bumps point outward
      const sweep = outward[0] * -uy + outward[1] * ux > 0 ? 0 : 1;
      s += `A${f(rr)} ${f(rr)} 0 0 ${sweep} ${f(ex)} ${f(ey)}`;
    }
    return s;
  };
  const outer =
    `M${f(L)} ${f(T)}` +
    edge([L, T], [R, T], [0, -1]) +
    edge([R, T], [R, B], [1, 0]) +
    edge([R, B], [L, B], [0, 1]) +
    edge([L, B], [L, T], [-1, 0]) +
    'Z';
  const band = 3.2 * spec.scale;
  const innerLine = `M${f(L + band * 2)} ${f(T + band * 2)}H${f(R - band * 2)}V${f(B - band * 2)}H${f(L + band * 2)}Z`;
  // Filled scalloped band: outer scallops minus an inner rectangle (even-odd).
  const inner = `M${f(L + band)} ${f(T + band)}V${f(B - band)}H${f(R - band)}V${f(T + band)}Z`;
  return (
    `<path fill="${x.c1}" fill-rule="evenodd" d="${outer}${inner}"/>` +
    `<path fill="none" stroke="${x.c1}" stroke-opacity="0.7" stroke-width="${f(0.6 * spec.scale)}" d="${innerLine}"/>` +
    `<path fill="${x.c2}" fill-opacity="0.9" d="${dotsAlong(L, T, R, B, target, spec.scale)}"/>`
  );
}

function dotsAlong(L: number, T: number, R: number, B: number, step: number, scale: number) {
  let d = '';
  const rad = 0.7 * scale;
  for (let xx = L + step; xx < R - step / 2; xx += step) d += circlePath(xx, T + 1.6 * scale, rad) + circlePath(xx, B - 1.6 * scale, rad);
  for (let yy = T + step; yy < B - step / 2; yy += step) d += circlePath(L + 1.6 * scale, yy, rad) + circlePath(R - 1.6 * scale, yy, rad);
  return d;
}

function radialGlow(x: Ctx) {
  const { r, W, H, spec, id } = x;
  const cx = (0.5 + gauss(r) * 0.15) * W;
  const cy = (0.38 + gauss(r) * 0.12) * H;
  const R = Math.hypot(W, H) * (0.45 + spec.scale * 0.15);
  const g1 = `${id}-glow`;
  const g2 = `${id}-glow2`;
  const gB = `${id}-bokeh`;
  const defs =
    `<defs>` +
    `<radialGradient id="${g1}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}"><stop offset="0" stop-color="${x.c3}" stop-opacity="0.85"/><stop offset="0.18" stop-color="${x.c1}" stop-opacity="0.75"/><stop offset="0.55" stop-color="${x.c1}" stop-opacity="0.25"/><stop offset="1" stop-color="${x.c2}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${g2}" gradientUnits="userSpaceOnUse" cx="${f(W - cx)}" cy="${f(H * 0.85)}" r="${f(R * 0.6)}"><stop offset="0" stop-color="${x.c2}" stop-opacity="0.55"/><stop offset="1" stop-color="${x.c2}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${gB}"><stop offset="0" stop-color="${x.c3}" stop-opacity="0.55"/><stop offset="0.7" stop-color="${x.c3}" stop-opacity="0.22"/><stop offset="1" stop-color="${x.c3}" stop-opacity="0"/></radialGradient>` +
    `</defs>`;
  let bokeh = '';
  const n = Math.round(6 + spec.density * 22);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const dist = R * (0.15 + r() * 0.6);
    const bx = cx + Math.cos(a) * dist;
    const by = cy + Math.sin(a) * dist * 0.8;
    const br = (3 + r() ** 1.5 * 16) * spec.scale;
    bokeh += `<circle cx="${f(bx)}" cy="${f(by)}" r="${f(br)}" fill="url(#${gB})"/>`;
  }
  return `${defs}<rect width="${f(W)}" height="${f(H)}" fill="url(#${g1})"/><rect width="${f(W)}" height="${f(H)}" fill="url(#${g2})"/>${bokeh}`;
}

const GENERATORS: Record<BackdropKind, (x: Ctx) => string> = {
  cardstock,
  linen,
  watercolor,
  snowfall,
  stars,
  plaid,
  'deco-border': decoBorder,
  'scallop-frame': scallopFrame,
  'radial-glow': radialGlow,
};

/**
 * The backdrop as a standalone SVG string covering the whole bleed area of a surface.
 * `idPrefix` must be unique per rendered instance (gradient ids).
 */
export function backdropSvg(input: BackdropSpec, theme: Theme, box: BackdropBox, idPrefix = 'hcbd'): string {
  const spec = sanitizeBackdrop(input);
  if (!spec) return '';
  const bleed = Math.max(0, box.bleedIn);
  const W = (box.widthIn + bleed * 2) * U;
  const H = (box.heightIn + bleed * 2) * U;
  const resolve = (ref: ColorRef | undefined, fb: string) => safeHex(resolveColor(ref ?? fb, theme, fb), fb);
  const ctx: Ctx = {
    r: prng(spec.seed ^ 0x5bd1e995),
    W,
    H,
    tx: bleed * U,
    ty: bleed * U,
    tw: box.widthIn * U,
    th: box.heightIn * U,
    spec,
    c1: resolve(spec.colors.primary, '#888888'),
    c2: resolve(spec.colors.secondary, '#bbbbbb'),
    c3: resolve(spec.colors.tertiary ?? spec.colors.secondary, '#ffffff'),
    id: safeId(idPrefix),
  };
  const body = GENERATORS[spec.kind](ctx);
  const op = spec.opacity < 1 ? ` opacity="${f(spec.opacity)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="100%" height="100%" preserveAspectRatio="none" style="display:block" aria-hidden="true"><g${op}>${body}</g></svg>`;
}
