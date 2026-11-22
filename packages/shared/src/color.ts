import type { ColorRef, Theme, ThemeColors } from './types';

export type RGB = [number, number, number]; // 0..255
export type RGBA = [number, number, number, number]; // alpha 0..1

export function parseHex(hex: string): RGBA {
  let h = hex.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return [0, 0, 0, 1];
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export function toHex(rgb: RGB | RGBA, withAlpha = false): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  const base = `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
  if (withAlpha && rgb.length === 4 && rgb[3] < 1) return base + c(rgb[3] * 255);
  return base;
}

export function isHexColor(s: string) {
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/* ---------- sRGB ↔ linear ↔ OKLab/OKLCH ---------- */

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

export function rgbToOklab([r, g, b]: RGB | RGBA): [number, number, number] {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export interface OKLCH {
  l: number; // 0..1
  c: number; // 0..~0.4
  h: number; // degrees
}

export function hexToOklch(hex: string): OKLCH {
  const [L, a, b] = rgbToOklab(parseHex(hex));
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToHex({ l, c, h }: OKLCH): string {
  // Reduce chroma until in gamut (simple binary search).
  const rad = (h * Math.PI) / 180;
  let lo = 0, hi = c, best = 0;
  const inGamut = (cc: number) => {
    const L = l, A = cc * Math.cos(rad), B = cc * Math.sin(rad);
    const lr = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const mr = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const sr = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const r = 4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr;
    const g = -1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr;
    const bb = -0.0041960863 * lr - 0.7034186147 * mr + 1.707614701 * sr;
    const e = 0.0005;
    return r >= -e && r <= 1 + e && g >= -e && g <= 1 + e && bb >= -e && bb <= 1 + e;
  };
  if (inGamut(c)) best = c;
  else {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) { best = mid; lo = mid; } else hi = mid;
    }
  }
  return toHex(oklabToRgb([l, best * Math.cos(rad), best * Math.sin(rad)]));
}

/* ---------- WCAG ---------- */

export function relativeLuminance(rgb: RGB | RGBA): number {
  return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

export function contrastRatio(a: RGB | RGBA | string, b: RGB | RGBA | string): number {
  const ra = typeof a === 'string' ? parseHex(a) : a;
  const rb = typeof b === 'string' ? parseHex(b) : b;
  const la = relativeLuminance(ra), lb = relativeLuminance(rb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Blend `top` (with alpha) over `bottom`. */
export function blend(bottom: RGB | RGBA, top: RGB | RGBA, alpha?: number): RGB {
  const a = alpha ?? (top.length === 4 ? top[3] : 1);
  return [
    bottom[0] + (top[0] - bottom[0]) * a,
    bottom[1] + (top[1] - bottom[1]) * a,
    bottom[2] + (top[2] - bottom[2]) * a,
  ];
}

export function mixHex(a: string, b: string, t: number): string {
  return toHex(blend(parseHex(a), parseHex(b), t));
}

/** Adjust OKLCH lightness of `fg` until it reaches `target` contrast against `bg`. */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  if (contrastRatio(fg, bg) >= target) return fg;
  const base = hexToOklch(fg);
  const bgL = hexToOklch(bg).l;
  const goDark = bgL > 0.6;
  for (let i = 1; i <= 40; i++) {
    const l = goDark ? base.l - (base.l * i) / 40 : base.l + ((1 - base.l) * i) / 40;
    const cand = oklchToHex({ l, c: base.c * (1 - i / 60), h: base.h });
    if (contrastRatio(cand, bg) >= target) return cand;
  }
  // Fall back to near-black/white, whichever contrasts better.
  return contrastRatio('#000000', bg) > contrastRatio('#ffffff', bg) ? '#111111' : '#ffffff';
}

export function bestTextOn(bg: string, dark = '#1c1917', light = '#ffffff'): string {
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
}

/* ---------- Theme references ---------- */

export const THEME_TOKENS: Array<keyof ThemeColors> = [
  'background',
  'surface',
  'text',
  'textMuted',
  'accent',
  'accent2',
  'onPhoto',
  'scrim',
];

export const THEME_TOKEN_LABELS: Record<keyof ThemeColors, string> = {
  background: 'Background',
  surface: 'Panel',
  text: 'Text',
  textMuted: 'Soft text',
  accent: 'Accent',
  accent2: 'Accent 2',
  onPhoto: 'Text on photo',
  scrim: 'Shade',
};

/** Resolve "@token" or "#hex" into a hex colour using the theme. */
export function resolveColor(ref: ColorRef | null | undefined, theme: Theme, fallback = '#000000'): string {
  if (!ref) return fallback;
  if (ref.startsWith('@')) {
    const key = ref.slice(1) as keyof ThemeColors;
    return theme.colors[key] ?? fallback;
  }
  return isHexColor(ref) ? ref : fallback;
}

/* ---------- Foils ---------- */

export interface FoilDef {
  id: string;
  name: string;
  /** CSS gradient used as background-clip:text fill. */
  gradient: string;
  /** Representative mid colour for contrast checks / swatches. */
  mid: string;
  texture?: string | null;
}

export const BUILTIN_FOILS: FoilDef[] = [
  {
    id: 'gold',
    name: 'Gold foil',
    mid: '#c9a54a',
    gradient:
      'linear-gradient(135deg, #8a6a1f 0%, #e8cf7a 22%, #b8892c 38%, #f6e7a8 52%, #a97c26 68%, #e3c06a 84%, #7f5f1a 100%)',
  },
  {
    id: 'silver',
    name: 'Silver foil',
    mid: '#b9bec6',
    gradient:
      'linear-gradient(135deg, #7b8089 0%, #e9ecf0 22%, #9aa0a8 38%, #fbfcfd 52%, #8d939b 68%, #dde1e6 84%, #6d727a 100%)',
  },
  {
    id: 'rose-gold',
    name: 'Rose gold foil',
    mid: '#d49a8c',
    gradient:
      'linear-gradient(135deg, #9a5f52 0%, #f0c3b5 22%, #c07e6e 38%, #fbe0d6 52%, #b5705f 68%, #e9b3a3 84%, #8a5044 100%)',
  },
  {
    id: 'copper',
    name: 'Copper foil',
    mid: '#b87333',
    gradient:
      'linear-gradient(135deg, #7a3f17 0%, #e6a067 22%, #a85b28 38%, #f6c59a 52%, #96501f 68%, #d98c52 84%, #6a3512 100%)',
  },
];
