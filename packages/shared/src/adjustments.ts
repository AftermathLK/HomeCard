/**
 * Photo Polish pixel pipeline.
 *
 * This single module runs in the browser (Web Worker, on preview images) AND on the server
 * (Sharp raw buffers, on full-resolution originals). Every operation is a per-pixel function
 * with no spatial dependence, so the print output matches the on-screen preview regardless
 * of resolution. Vignette and grain are rendered as vector/texture overlays at physical size.
 */
import type { Adjustments, PhotoPolish } from './types';
import { hashString } from './units';

export const NEUTRAL: Adjustments = Object.freeze({
  brightness: 0,
  contrast: 0,
  warmth: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  shadows: 0,
  highlights: 0,
  fade: 0,
  grayscale: 0,
  sepia: 0,
  vignette: 0,
  grain: 0,
}) as Adjustments;

export const ADJUSTMENT_KEYS = Object.keys(NEUTRAL) as Array<keyof Adjustments>;

const RANGES: Record<keyof Adjustments, [number, number]> = {
  brightness: [-1, 1],
  contrast: [-1, 1],
  warmth: [-1, 1],
  tint: [-1, 1],
  vibrance: [-1, 1],
  saturation: [-1, 1],
  shadows: [-1, 1],
  highlights: [-1, 1],
  fade: [0, 1],
  grayscale: [0, 1],
  sepia: [0, 1],
  vignette: [0, 1],
  grain: [0, 1],
};

export function neutral(): Adjustments {
  return { ...NEUTRAL };
}

export function defaultPolish(): PhotoPolish {
  return { auto: null, filterId: null, filterStrength: 1, user: neutral() };
}

/* ---------- Filters ---------- */

export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  adjust: Partial<Adjustments>;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'bright-airy',
    name: 'Bright & Airy',
    description: 'Light, clean and fresh — lifts shadows and softens contrast.',
    adjust: { brightness: 0.2, contrast: -0.12, shadows: 0.28, highlights: -0.12, saturation: -0.06, vibrance: 0.12, warmth: 0.05, fade: 0.05 },
  },
  {
    id: 'warm-film',
    name: 'Warm Film',
    description: 'Golden-hour warmth with a gentle film fade and grain.',
    adjust: { warmth: 0.3, tint: 0.05, contrast: 0.08, fade: 0.14, saturation: -0.1, highlights: -0.16, grain: 0.35, vignette: 0.2 },
  },
  {
    id: 'crisp-classic',
    name: 'Crisp Classic',
    description: 'Punchy, true-to-life colour with crisp contrast.',
    adjust: { contrast: 0.26, vibrance: 0.24, shadows: 0.08, highlights: -0.12, brightness: 0.03 },
  },
  {
    id: 'timeless-bw',
    name: 'Timeless B&W',
    description: 'Rich black & white with deep blacks and soft grain.',
    adjust: { grayscale: 1, contrast: 0.24, shadows: 0.06, highlights: -0.08, grain: 0.2, vignette: 0.15 },
  },
  {
    id: 'cozy-vintage',
    name: 'Cozy Vintage',
    description: 'Sepia warmth, faded blacks and a soft vignette.',
    adjust: { sepia: 0.35, warmth: 0.18, fade: 0.22, contrast: -0.05, saturation: -0.22, vignette: 0.35, grain: 0.3 },
  },
  {
    id: 'soft-matte',
    name: 'Soft Matte',
    description: 'Muted, matte finish with gentle tones.',
    adjust: { fade: 0.24, contrast: -0.15, saturation: -0.12, highlights: -0.15, shadows: 0.15, warmth: 0.04 },
  },
];

export function getFilter(id: string | null | undefined) {
  return id ? FILTER_PRESETS.find((f) => f.id === id) ?? null : null;
}

/** Combine auto-enhance, filter and user sliders into the effective adjustment set. */
export function effectiveAdjustments(p: PhotoPolish | null | undefined): Adjustments {
  const out = neutral();
  if (!p) return out;
  const filter = getFilter(p.filterId);
  for (const k of ADJUSTMENT_KEYS) {
    let v = (p.auto?.[k] ?? 0) + (p.user?.[k] ?? 0);
    if (filter) v += (filter.adjust[k] ?? 0) * (p.filterStrength ?? 1);
    const [lo, hi] = RANGES[k];
    out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function isNeutral(a: Adjustments, keys: Array<keyof Adjustments> = ADJUSTMENT_KEYS): boolean {
  return keys.every((k) => Math.abs(a[k]) < 1e-4);
}

/** Pixel-affecting keys (vignette/grain are overlays). */
export const PIXEL_KEYS = ADJUSTMENT_KEYS.filter((k) => k !== 'vignette' && k !== 'grain');

export function pixelAdjustments(a: Adjustments): Partial<Adjustments> {
  const o: Partial<Adjustments> = {};
  for (const k of PIXEL_KEYS) if (Math.abs(a[k]) >= 1e-4) o[k] = Math.round(a[k] * 1000) / 1000;
  return o;
}

export function adjustmentsKey(a: Adjustments): string {
  const p = pixelAdjustments(a);
  const keys = Object.keys(p);
  return keys.length ? hashString(JSON.stringify(p)) : 'none';
}

/* ---------- Pipeline ---------- */

export interface Pipeline {
  lut: [Uint8Array, Uint8Array, Uint8Array];
  saturation: number;
  vibrance: number;
  grayscale: number;
  sepia: number;
  needsPerPixel: boolean;
  identity: boolean;
}

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const linToSrgb = (v: number) => {
  v = Math.min(1, Math.max(0, v));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
const smoothstep = (v: number) => v * v * (3 - 2 * v);

export function buildPipeline(input: Partial<Adjustments>): Pipeline {
  const a = { ...NEUTRAL, ...input };
  // White balance gains (applied in linear light).
  const gains: [number, number, number] = [
    1 + 0.14 * a.warmth + 0.05 * a.tint,
    1 + 0.015 * a.warmth - 0.09 * a.tint,
    1 - 0.16 * a.warmth + 0.05 * a.tint,
  ];
  const gammaExp = 2 ** (-a.brightness * 1.25);
  const luts = [0, 1, 2].map((ch) => {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let v = linToSrgb(SRGB_TO_LIN[i] * gains[ch]);
      // Brightness: midtone gamma (no clipping).
      if (a.brightness) v = v ** gammaExp;
      // Shadows: lift/deepen the lower tones.
      if (a.shadows) v = v + a.shadows * 0.32 * 3.375 * v * (1 - v) * (1 - v);
      // Highlights: recover/boost upper tones.
      if (a.highlights) v = v + a.highlights * 0.28 * 6.75 * v * v * (1 - v);
      v = Math.min(1, Math.max(0, v));
      // Contrast: S-curve for positive, flatten for negative.
      if (a.contrast > 0) v = v + (smoothstep(v) - v) * a.contrast;
      else if (a.contrast < 0) v = 0.5 + (v - 0.5) * (1 + 0.55 * a.contrast);
      // Fade: matte black lift.
      if (a.fade) v = a.fade * 0.17 + v * (1 - a.fade * 0.17 - a.fade * 0.04);
      lut[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    return lut;
  }) as [Uint8Array, Uint8Array, Uint8Array];
  const identity =
    luts.every((l) => l.every((v, i) => v === i)) &&
    !a.saturation && !a.vibrance && !a.grayscale && !a.sepia;
  return {
    lut: luts,
    saturation: a.saturation,
    vibrance: a.vibrance,
    grayscale: a.grayscale,
    sepia: a.sepia,
    needsPerPixel: !!(a.saturation || a.vibrance || a.grayscale || a.sepia),
    identity,
  };
}

/** Skin-tone likelihood (0..1) from RGB in 0..255. */
export function skinWeight(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 40 || r < g || r < b) return 0;
  const sat = (max - min) / max;
  if (sat < 0.08 || sat > 0.75) return 0;
  // Hue in degrees for red-dominant pixels.
  const d = max - min || 1;
  let h = 60 * (((g - b) / d) % 6);
  if (h < 0) h += 360;
  const dh = h > 180 ? h - 360 : h;
  const hueW = Math.exp(-((dh - 22) ** 2) / (2 * 14 * 14));
  return hueW * Math.min(1, sat / 0.18);
}

export function applyPixel(r: number, g: number, b: number, p: Pipeline): [number, number, number] {
  r = p.lut[0][r];
  g = p.lut[1][g];
  b = p.lut[2][b];
  if (!p.needsPerPixel) return [r, g, b];
  let fr = r, fg = g, fb = b;
  if (p.saturation || p.vibrance) {
    const y = 0.2126 * fr + 0.7152 * fg + 0.0722 * fb;
    const max = Math.max(fr, fg, fb), min = Math.min(fr, fg, fb);
    const sat = max > 0 ? (max - min) / max : 0;
    let vib = p.vibrance;
    if (vib > 0) vib = vib * (1 - sat) * (1 - 0.75 * skinWeight(r, g, b));
    else vib = vib * (0.4 + 0.6 * sat);
    const k = (1 + p.saturation) * (1 + vib * 0.9);
    fr = y + (fr - y) * k;
    fg = y + (fg - y) * k;
    fb = y + (fb - y) * k;
  }
  if (p.grayscale) {
    const y = 0.3 * fr + 0.59 * fg + 0.11 * fb;
    fr += (y - fr) * p.grayscale;
    fg += (y - fg) * p.grayscale;
    fb += (y - fb) * p.grayscale;
  }
  if (p.sepia) {
    const sr = 0.393 * fr + 0.769 * fg + 0.189 * fb;
    const sg = 0.349 * fr + 0.686 * fg + 0.168 * fb;
    const sb = 0.272 * fr + 0.534 * fg + 0.131 * fb;
    fr += (sr - fr) * p.sepia;
    fg += (sg - fg) * p.sepia;
    fb += (sb - fb) * p.sepia;
  }
  return [clamp255(fr), clamp255(fg), clamp255(fb)];
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Apply the pipeline in place to RGB/RGBA bytes. */
export function applyPipeline(data: Uint8Array | Uint8ClampedArray, channels: 3 | 4, p: Pipeline): void {
  if (p.identity) return;
  const [lr, lg, lb] = p.lut;
  const n = data.length;
  if (!p.needsPerPixel) {
    for (let i = 0; i < n; i += channels) {
      data[i] = lr[data[i]];
      data[i + 1] = lg[data[i + 1]];
      data[i + 2] = lb[data[i + 2]];
    }
    return;
  }
  for (let i = 0; i < n; i += channels) {
    const o = applyPixel(data[i], data[i + 1], data[i + 2], p);
    data[i] = o[0];
    data[i + 1] = o[1];
    data[i + 2] = o[2];
  }
}

/* ---------- Statistics & Auto-Enhance ---------- */

export interface ImageStats {
  mean: number;
  p01: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
  clippedHigh: number;
  clippedLow: number;
  avgR: number;
  avgG: number;
  avgB: number;
  meanSat: number;
  skinFraction: number;
}

export function computeImageStats(data: ArrayLike<number>, channels: 3 | 4, maxSamples = 60000): ImageStats {
  const total = Math.floor(data.length / channels);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const hist = new Float64Array(256);
  let n = 0, sum = 0, sr = 0, sg = 0, sb = 0, sw = 0, satSum = 0, skin = 0, hi = 0, lo = 0;
  for (let i = 0; i < total; i += step) {
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 128) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hist[y]++;
    n++;
    sum += y;
    if (y > 250) hi++;
    if (y < 5) lo++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    satSum += sat;
    if (skinWeight(r, g, b) > 0.5) skin++;
    // Gray-world estimate from mid-tone, low-saturation pixels.
    if (y > 30 && y < 230) {
      const w = 1 - Math.min(1, sat * 1.5);
      sr += r * w; sg += g * w; sb += b * w; sw += w;
    }
  }
  n = n || 1;
  const pct = (q: number) => {
    let acc = 0;
    const target = q * n;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  sw = sw || 1;
  return {
    mean: sum / n / 255,
    p01: pct(0.01),
    p05: pct(0.05),
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    clippedHigh: hi / n,
    clippedLow: lo / n,
    avgR: sr / sw / 255,
    avgG: sg / sw / 255,
    avgB: sb / sw / 255,
    meanSat: satSum / n,
    skinFraction: skin / n,
  };
}

const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Gentle, photographer-style auto correction: exposure balance, shadow lift for dim indoor
 * shots, white-balance warmth correction and natural (skin-protecting) vibrance.
 */
export function autoEnhance(s: ImageStats): Adjustments {
  const a = neutral();
  // Exposure: aim the median toward a pleasant 0.47.
  a.brightness = c((0.47 - s.p50) * 2.1, -0.3, 0.5);
  // Dim photos: lift shadows.
  if (s.p05 < 0.1 && s.mean < 0.5) a.shadows = c((0.12 - s.p05) * 3.2 + (0.45 - s.mean) * 0.6, 0, 0.55);
  // Blown highlights: recover.
  if (s.clippedHigh > 0.015 || s.p99 > 0.985) a.highlights = c(-0.12 - s.clippedHigh * 4, -0.45, 0);
  // Contrast: stretch flat images, soften harsh ones.
  const range = s.p95 - s.p05;
  if (range < 0.62) a.contrast = c((0.72 - range) * 0.9, 0, 0.32);
  else if (range > 0.93) a.contrast = -0.08;
  // White balance (gray world) — correct casts, finish slightly warm.
  const rb = (s.avgB - s.avgR) / Math.max(0.05, s.avgR + s.avgB);
  if (rb > 0) a.warmth = c(rb * 3.2 + 0.05, 0, 0.45);
  else a.warmth = c(rb * 2.2 + 0.04, -0.3, 0.06);
  const gExcess = (s.avgG - (s.avgR + s.avgB) / 2) / Math.max(0.05, s.avgG);
  a.tint = c(gExcess * 2.2, -0.2, 0.25);
  // Vibrance (natural; skin protected in the pipeline).
  a.vibrance = s.meanSat < 0.28 ? c((0.32 - s.meanSat) * 1.4, 0.06, 0.38) : 0.06;
  if (s.skinFraction > 0.15) a.vibrance *= 0.8;
  for (const k of ADJUSTMENT_KEYS) a[k] = Math.round(a[k] * 1000) / 1000;
  return a;
}

/* ---------- Saliency (focus point when no faces) ---------- */

/** Weighted centroid of salient pixels (skin, saturation, local contrast). Input: small RGB(A) image. */
export function saliencyFocus(data: ArrayLike<number>, width: number, height: number, channels: 3 | 4) {
  const score = new Float32Array(width * height);
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    lum[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  let maxScore = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const o = i * channels;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + width] - lum[i - width];
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 80);
      // Gentle centre bias
      const dx = x / width - 0.5, dy = y / height - 0.45;
      const centre = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.2);
      const s = skinWeight(r, g, b) * 2.2 + sat * 0.6 + edge * 0.9 + centre * 0.5;
      score[i] = s;
      if (s > maxScore) maxScore = s;
    }
  }
  const thresh = maxScore * 0.6;
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = score[y * width + x];
      if (s >= thresh) {
        sx += (x + 0.5) * s;
        sy += (y + 0.5) * s;
        sw += s;
      }
    }
  if (!sw) return { x: 0.5, y: 0.45 };
  return { x: sx / sw / width, y: sy / sw / height };
}
