import { contrastRatio, ensureContrast, hexToOklch, oklabToRgb, oklchToHex, rgbToOklab, toHex } from './color';
import type { ThemeColors } from './types';

export interface PaletteColor {
  hex: string;
  /** Fraction of sampled pixels (0..1). */
  weight: number;
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Lab = [number, number, number];
const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function kmeans(points: Lab[], weights: number[], k: number, seed = 7): { centers: Lab[]; sizes: number[] } {
  const rand = prng(seed);
  const n = points.length;
  if (n === 0) return { centers: [], sizes: [] };
  k = Math.min(k, n);
  // k-means++ initialisation
  const centers: Lab[] = [points[Math.floor(rand() * n)]];
  const d = new Float64Array(n);
  while (centers.length < k) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (const c of centers) m = Math.min(m, dist2(points[i], c));
      d[i] = m * weights[i];
      sum += d[i];
    }
    let r = rand() * sum;
    let idx = 0;
    for (; idx < n - 1; idx++) {
      r -= d[idx];
      if (r <= 0) break;
    }
    centers.push(points[idx]);
  }
  const assign = new Int32Array(n);
  const sizes = new Array(k).fill(0);
  for (let iter = 0; iter < 14; iter++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dd = dist2(points[i], centers[c]);
        if (dd < bd) { bd = dd; best = c; }
      }
      assign[i] = best;
      const w = weights[i];
      acc[best][0] += points[i][0] * w;
      acc[best][1] += points[i][1] * w;
      acc[best][2] += points[i][2] * w;
      acc[best][3] += w;
    }
    for (let c = 0; c < centers.length; c++) {
      if (acc[c][3] > 0) centers[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
      sizes[c] = acc[c][3];
    }
  }
  return { centers, sizes };
}

/**
 * Extract dominant colours from raw pixels (RGB or RGBA). Works identically in browser
 * (canvas ImageData) and node (sharp raw buffers).
 */
export function extractPalette(
  data: ArrayLike<number>,
  channels: 3 | 4,
  k = 5,
  maxSamples = 5000,
): PaletteColor[] {
  const total = Math.floor(data.length / channels);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const pts: Lab[] = [];
  const ws: number[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 128) continue;
    const lab = rgbToOklab([data[o], data[o + 1], data[o + 2]]);
    pts.push(lab);
    // Slightly favour chromatic pixels so accents surface even when small.
    const chroma = Math.sqrt(lab[1] ** 2 + lab[2] ** 2);
    ws.push(1 + chroma * 4);
  }
  const { centers, sizes } = kmeans(pts, ws, k + 2);
  const totalW = sizes.reduce((a, b) => a + b, 0) || 1;
  let colors = centers.map((c, i) => ({ lab: c, weight: sizes[i] / totalW }));
  // Merge near-duplicates
  colors.sort((a, b) => b.weight - a.weight);
  const merged: typeof colors = [];
  for (const c of colors) {
    const twin = merged.find((m) => dist2(m.lab, c.lab) < 0.0016);
    if (twin) twin.weight += c.weight;
    else merged.push({ ...c });
  }
  return merged
    .slice(0, k)
    .map((c) => ({ hex: toHex(oklabToRgb(c.lab)), weight: c.weight }));
}

/** Combine palettes from several photos (weighted) into one palette of `k` colours. */
export function mergePalettes(palettes: PaletteColor[][], k = 5): PaletteColor[] {
  const pts: Lab[] = [];
  const ws: number[] = [];
  for (const p of palettes)
    for (const c of p) {
      const [r, g, b] = [parseInt(c.hex.slice(1, 3), 16), parseInt(c.hex.slice(3, 5), 16), parseInt(c.hex.slice(5, 7), 16)];
      pts.push(rgbToOklab([r, g, b]));
      ws.push(c.weight);
    }
  if (!pts.length) return [];
  if (pts.length <= k) return palettes.flat().sort((a, b) => b.weight - a.weight);
  const { centers, sizes } = kmeans(pts, ws, k, 11);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return centers
    .map((c, i) => ({ hex: toHex(oklabToRgb(c)), weight: sizes[i] / total }))
    .sort((a, b) => b.weight - a.weight);
}

export interface HarmonyTheme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

const L = (hex: string) => hexToOklch(hex);

/** Generate contrast-safe card themes from a photo palette. */
export function harmonyThemes(palette: PaletteColor[]): HarmonyTheme[] {
  if (!palette.length) return [];
  const withLch = palette.map((p) => ({ ...p, lch: L(p.hex) }));
  const dominant = withLch[0];
  const vivid = [...withLch].sort((a, b) => b.lch.c * (0.4 + b.weight) - a.lch.c * (0.4 + a.weight))[0];
  const second =
    [...withLch]
      .filter((p) => p !== vivid && Math.abs(hueDelta(p.lch.h, vivid.lch.h)) > 25)
      .sort((a, b) => b.lch.c - a.lch.c)[0] ?? withLch[1] ?? vivid;
  const darkest = [...withLch].sort((a, b) => a.lch.l - b.lch.l)[0];

  const accentHue = vivid.lch.c > 0.03 ? vivid.lch.h : dominant.lch.h;
  const accentC = Math.max(0.08, Math.min(0.17, vivid.lch.c));
  const secondHue = second.lch.c > 0.03 ? second.lch.h : (accentHue + 40) % 360;

  const themes: HarmonyTheme[] = [];

  // 1. Light & Airy
  {
    const background = oklchToHex({ l: 0.972, c: Math.min(0.018, dominant.lch.c * 0.3), h: dominant.lch.h });
    const text = ensureContrast(oklchToHex({ l: 0.26, c: Math.min(0.05, darkest.lch.c), h: darkest.lch.h }), background, 7);
    themes.push({
      id: 'harmony-light',
      name: 'Light & Airy',
      description: 'Soft tinted paper with deep text pulled from your photos.',
      colors: finish({
        background,
        text,
        accent: ensureContrast(oklchToHex({ l: 0.52, c: accentC, h: accentHue }), background, 3),
        accent2: oklchToHex({ l: 0.68, c: Math.min(0.12, second.lch.c), h: secondHue }),
      }),
    });
  }
  // 2. Deep & Rich
  {
    const background = oklchToHex({ l: 0.24, c: Math.min(0.07, Math.max(0.03, darkest.lch.c + 0.02)), h: darkest.lch.c > 0.02 ? darkest.lch.h : accentHue });
    const text = ensureContrast(oklchToHex({ l: 0.95, c: 0.015, h: 85 }), background, 7);
    themes.push({
      id: 'harmony-deep',
      name: 'Deep & Rich',
      description: 'Moody dark ground — perfect with gold foil.',
      colors: finish({
        background,
        text,
        accent: ensureContrast(oklchToHex({ l: 0.8, c: Math.min(0.13, accentC), h: accentHue }), background, 3),
        accent2: oklchToHex({ l: 0.7, c: Math.min(0.1, second.lch.c), h: secondHue }),
      }),
    });
  }
  // 3. Bold Accent ground
  {
    const background = oklchToHex({ l: 0.46, c: Math.min(0.15, accentC + 0.02), h: accentHue });
    const text = ensureContrast('#fffaf2', background, 4.5);
    themes.push({
      id: 'harmony-bold',
      name: 'Bold Colour',
      description: 'The most vivid colour in your photos as the card colour.',
      colors: finish({
        background,
        text,
        accent: ensureContrast(oklchToHex({ l: 0.9, c: 0.05, h: secondHue }), background, 3),
        accent2: oklchToHex({ l: 0.8, c: 0.08, h: secondHue }),
      }),
    });
  }
  // 4. Warm Neutral
  {
    const background = oklchToHex({ l: 0.95, c: 0.022, h: 80 });
    const text = ensureContrast(oklchToHex({ l: 0.3, c: Math.min(0.04, darkest.lch.c), h: darkest.lch.h }), background, 7);
    themes.push({
      id: 'harmony-neutral',
      name: 'Warm Neutral',
      description: 'Cream cardstock with an accent from your photos.',
      colors: finish({
        background,
        text,
        accent: ensureContrast(oklchToHex({ l: 0.5, c: accentC, h: accentHue }), background, 3),
        accent2: oklchToHex({ l: 0.62, c: 0.08, h: secondHue }),
      }),
    });
  }
  // 5. Complementary Pop
  {
    const comp = (dominant.lch.h + 180) % 360;
    const background = oklchToHex({ l: 0.975, c: 0.01, h: comp });
    const text = ensureContrast(oklchToHex({ l: 0.25, c: 0.03, h: dominant.lch.h }), background, 7);
    themes.push({
      id: 'harmony-complement',
      name: 'Complementary Pop',
      description: 'An accent opposite your photos’ main colour so they stand out.',
      colors: finish({
        background,
        text,
        accent: ensureContrast(oklchToHex({ l: 0.55, c: 0.15, h: comp }), background, 3),
        accent2: oklchToHex({ l: 0.62, c: Math.min(0.12, dominant.lch.c + 0.03), h: dominant.lch.h }),
      }),
    });
  }
  return themes;
}

function hueDelta(a: number, b: number) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Fill derived theme tokens (surface, textMuted, onPhoto, scrim) with enforced contrast. */
export function finish(c: { background: string; text: string; accent: string; accent2: string; surface?: string }): ThemeColors {
  const bg = L(c.background);
  const surface = c.surface ?? oklchToHex({ l: bg.l > 0.5 ? Math.min(1, bg.l + 0.025) : bg.l + 0.06, c: bg.c * 0.8, h: bg.h });
  const textL = L(c.text);
  const textMuted = ensureContrast(
    oklchToHex({ l: textL.l + (bg.l - textL.l) * 0.35, c: textL.c * 0.8, h: textL.h }),
    c.background,
    4.5,
  );
  return {
    background: c.background,
    surface,
    text: c.text,
    textMuted,
    accent: c.accent,
    accent2: c.accent2,
    onPhoto: '#ffffff',
    scrim: oklchToHex({ l: 0.14, c: Math.min(0.03, bg.c), h: bg.h }),
  };
}

/** Quick palette helper for authored palettes. */
export function palette(background: string, text: string, accent: string, accent2: string, surface?: string): ThemeColors {
  const t = contrastRatio(text, background) >= 4.5 ? text : ensureContrast(text, background, 4.5);
  return finish({ background, text: t, accent, accent2, surface });
}
