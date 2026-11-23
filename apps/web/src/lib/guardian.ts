import {
  applyPixel,
  backdropSvg,
  buildPipeline,
  contrastRatio,
  effectiveAdjustments,
  hexToOklch,
  oklchToHex,
  parseHex,
  photoContentBox,
  orientedFill,
  placeImage,
  unorientPoint,
  pixelAdjustments,
  resolveColor,
  rotatedBounds,
  type CardElement,
  type CardProject,
  type RectIn,
  type ResolvedStylePack,
  type ScrimElement,
  type Surface,
  type TextElement,
} from '@homecard/shared';
import { backgroundImageUrl, foilFor, textureLayout } from '@/render/CardSurface';
import { previewUrl } from './image';

/**
 * Readability measurement: composite what is underneath a text element at a grid of sample
 * points (background colour, image and Pattern-studio design → photos with Photo Polish applied
 * → shapes → scrims) and compute the WCAG contrast of the text colour against it. A low
 * percentile is used so busy photos count, and each vertical strip is also judged on its own so
 * a few letters sitting on a dark (or light) patch are caught even when the rest reads fine.
 */

type RGB = [number, number, number];
interface Pixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

const pixelCache = new Map<string, Promise<Pixels>>();

function loadPixels(ref: string): Promise<Pixels> {
  let p = pixelCache.get(ref);
  if (!p) {
    p = fetch(previewUrl(ref))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => createImageBitmap(b))
      .then((bm) => {
        const s = Math.min(1, 320 / Math.max(bm.width, bm.height));
        const w = Math.max(1, Math.round(bm.width * s));
        const h = Math.max(1, Math.round(bm.height * s));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bm, 0, 0, w, h);
        bm.close();
        return { data: ctx.getImageData(0, 0, w, h).data, w, h };
      });
    p.catch(() => pixelCache.delete(ref));
    pixelCache.set(ref, p);
  }
  return p;
}

/* ---------- the surface background, rasterised ---------- */

/** Background raster resolution: plenty for judging what sits behind a letter. */
const BG_PPI = 48;
const bgCache = new Map<string, Promise<Pixels | null>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

/**
 * The surface background (colour, stock/pack image, Pattern-studio backdrop) drawn the way
 * CardSurface draws it, over the full bleed area. null when it's a plain colour.
 */
function backgroundPixels(project: CardProject, surface: Surface, packs: ResolvedStylePack[]): Promise<Pixels | null> {
  const bg = surface.background;
  if (!bg.texture && !bg.backdrop) return Promise.resolve(null);
  const f = project.format;
  const key = JSON.stringify([bg, f.widthIn, f.heightIn, f.bleedIn, project.theme.colors]);
  let p = bgCache.get(key);
  if (!p) {
    p = (async () => {
      const b = f.bleedIn;
      const W = Math.max(1, Math.round((f.widthIn + 2 * b) * BG_PPI));
      const H = Math.max(1, Math.round((f.heightIn + 2 * b) * BG_PPI));
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = resolveColor(bg.color, project.theme, '#ffffff');
      ctx.fillRect(0, 0, W, H);
      const url = backgroundImageUrl(bg, f, packs, { mode: 'editor', dpi: 96 });
      if (url) {
        const img = await loadImage(url);
        const { mode, size } = textureLayout(bg, packs);
        ctx.globalAlpha = bg.textureOpacity ?? 1;
        if (mode === 'cover') {
          const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
          const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
          ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } else {
          const t = Math.max(2, Math.round(size * BG_PPI));
          const tile = document.createElement('canvas');
          tile.width = tile.height = t;
          tile.getContext('2d')!.drawImage(img, 0, 0, t, t);
          const pattern = ctx.createPattern(tile, 'repeat');
          if (pattern) {
            // Tiles are anchored to the trim corner, as on the card.
            pattern.setTransform(new DOMMatrix().translate(b * BG_PPI, b * BG_PPI));
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, W, H);
          }
        }
        ctx.globalAlpha = 1;
      }
      if (bg.backdrop) {
        const svg = backdropSvg(bg.backdrop, project.theme, { widthIn: f.widthIn, heightIn: f.heightIn, bleedIn: b }, 'hcgd').replace('width="100%" height="100%"', `width="${W}" height="${H}"`);
        if (svg) {
          const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          try {
            ctx.drawImage(await loadImage(u), 0, 0, W, H);
          } finally {
            URL.revokeObjectURL(u);
          }
        }
      }
      return { data: ctx.getImageData(0, 0, W, H).data, w: W, h: H };
    })().catch(() => null);
    bgCache.set(key, p);
    if (bgCache.size > 24) bgCache.delete(bgCache.keys().next().value!);
  }
  return p;
}

const rgb = (hex: string): RGB => {
  const [r, g, b] = parseHex(hex);
  return [r, g, b];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function bounds(e: CardElement): RectIn {
  return rotatedBounds({ x: e.x, y: e.y, w: e.w, h: e.h }, e.rotation || 0);
}
const hit = (r: RectIn, x: number, y: number) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const overlaps = (a: RectIn, b: RectIn) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function scrimAlpha(el: ScrimElement, x: number, y: number): number {
  const u = (x - el.x) / el.w;
  const v = (y - el.y) / el.h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const s = el.strength;
  if (el.direction === 'solid') return s;
  let p: number;
  switch (el.direction) {
    case 'to-top':
      p = 1 - v;
      break;
    case 'to-bottom':
      p = v;
      break;
    case 'to-left':
      p = 1 - u;
      break;
    case 'to-right':
      p = u;
      break;
    default:
      p = Math.min(1, Math.hypot((u - 0.5) * 2, (v - 0.5) * 2));
  }
  const e = el.extent;
  if (p <= e) return s;
  const mid = e + (1 - e) * 0.55;
  if (p <= mid) return s + (s * 0.35 - s) * ((p - e) / (mid - e));
  return s * 0.35 * (1 - (p - mid) / (1 - mid));
}

export async function measureContrast(project: CardProject, surface: Surface, text: TextElement, ink: RectIn, packs: ResolvedStylePack[]): Promise<number | undefined> {
  const theme = project.theme;
  const idx = surface.elements.findIndex((e) => e.id === text.id);
  const below = surface.elements.slice(0, idx).filter((e) => !e.hidden && overlaps(bounds(e), ink));
  const fg = text.fill === 'foil' ? foilFor(theme.foil || 'gold', packs).mid : resolveColor(text.color, theme, '#000000');
  const bg0 = rgb(resolveColor(surface.background.color, theme, '#ffffff'));
  const bgPx = await backgroundPixels(project, surface, packs);
  const bleed = project.format.bleedIn;

  const photoData = new Map<string, { px: Pixels; pipe: ReturnType<typeof buildPipeline> | null }>();
  for (const e of below) {
    if (e.type === 'photo' && e.fill && !photoData.has(e.id)) {
      try {
        const px = await loadPixels(e.fill.ref);
        const adj = pixelAdjustments(effectiveAdjustments(e.fill.polish));
        photoData.set(e.id, { px, pipe: Object.keys(adj).length ? buildPipeline(adj) : null });
      } catch {
        /* unreadable photo: ignore */
      }
    }
  }

  const NX = 12, NY = 4;
  const columns: number[][] = Array.from({ length: NX }, () => []);
  for (let iy = 0; iy < NY; iy++)
    for (let ix = 0; ix < NX; ix++) {
      const x = ink.x + ((ix + 0.5) / NX) * ink.w;
      const y = ink.y + ((iy + 0.5) / NY) * ink.h;
      let c: RGB = bg0;
      if (bgPx) {
        const px = Math.min(bgPx.w - 1, Math.max(0, Math.floor((x + bleed) * BG_PPI)));
        const py = Math.min(bgPx.h - 1, Math.max(0, Math.floor((y + bleed) * BG_PPI)));
        const o = (py * bgPx.w + px) * 4;
        c = [bgPx.data[o], bgPx.data[o + 1], bgPx.data[o + 2]];
      }
      for (const e of below) {
        const op = e.opacity ?? 1;
        if (e.type === 'photo' && e.fill) {
          const box = photoContentBox(e);
          const fx = x - e.x - box.x, fy = y - e.y - box.y;
          if (fx < 0 || fy < 0 || fx > box.w || fy > box.h) {
            if (e.frameStyle !== 'none' && hit({ x: e.x, y: e.y, w: e.w, h: e.h }, x, y)) c = mix(c, rgb(e.frameStyle === 'mat' ? resolveColor('@surface', theme) : '#fbfaf6'), op);
            continue;
          }
          const d = photoData.get(e.id);
          if (!d) continue;
          const ov = orientedFill(e.fill);
          const pl = placeImage(box.w, box.h, ov.width, ov.height, e.fill.crop);
          // Sample the original pixels: undo the user's turn/mirror.
          const [u, v] = unorientPoint((fx - pl.left) / pl.width, (fy - pl.top) / pl.height, e.fill);
          const px = Math.min(d.px.w - 1, Math.max(0, Math.floor(u * d.px.w)));
          const py = Math.min(d.px.h - 1, Math.max(0, Math.floor(v * d.px.h)));
          const o = (py * d.px.w + px) * 4;
          let p: RGB = [d.px.data[o], d.px.data[o + 1], d.px.data[o + 2]];
          if (d.pipe) p = applyPixel(p[0], p[1], p[2], d.pipe);
          const vig = effectiveAdjustments(e.fill.polish).vignette;
          if (vig > 0) {
            const r = Math.hypot((fx / box.w - 0.5) / 0.75, (fy / box.h - 0.5) / 0.75) * 2;
            const a = r <= 0.45 ? 0 : Math.min(1, (r - 0.45) / 0.55) * vig * 0.75;
            p = mix(p, [0, 0, 0], a);
          }
          c = mix(c, p, op);
        } else if (e.type === 'shape' && e.fill && hit(bounds(e), x, y)) {
          const [r, g, b, a] = parseHex(resolveColor(e.fill, theme, '#00000000'));
          c = mix(c, [r, g, b], a * op);
        } else if (e.type === 'scrim') {
          const [r, g, b] = parseHex(resolveColor(e.color, theme, '#000000'));
          c = mix(c, [r, g, b], scrimAlpha(e, x, y) * op);
        }
      }
      columns[ix].push(contrastRatio(fg, [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]));
    }
  const ratios = columns.flat().sort((a, b) => a - b);
  if (!ratios.length) return undefined;
  let r = ratios[Math.floor(ratios.length * 0.15)];
  // Judge each sixth of the width on its own too: if most of one stretch is unreadable (a few
  // letters on a dark patch of the background), the text is hard to read even if the rest is fine.
  for (let s = 0; s < NX; s += 2) {
    const strip = [...columns[s], ...columns[s + 1]].sort((a, b) => a - b);
    r = Math.min(r, strip[Math.floor(strip.length / 2)]);
  }
  // A drop shadow measurably improves legibility on busy backgrounds.
  if (text.shadow && text.fill !== 'foil') r = Math.min(21, r * 1.35);
  return Math.round(r * 100) / 100;
}

/**
 * Colour for the "Make readable" fix: the text's own hue made lighter or darker (OKLCH
 * lightness) just until the measured contrast against what is really underneath reaches
 * `target`. Keeps the design's look instead of jumping straight to black or white.
 * Returns null when contrast can't be measured.
 */
export async function findReadableColor(
  project: CardProject,
  surface: Surface,
  text: TextElement,
  ink: RectIn,
  packs: ResolvedStylePack[],
  target: number,
): Promise<{ color: string; ratio: number } | null> {
  const base = hexToOklch(resolveColor(text.color, project.theme, '#000000'));
  const STEPS = 24;
  let best: { color: string; ratio: number; step: number } | null = null;
  for (const lighter of [true, false]) {
    for (let i = 1; i <= STEPS; i++) {
      const l = lighter ? base.l + ((1 - base.l) * i) / STEPS : base.l - (base.l * i) / STEPS;
      const color = oklchToHex({ l, c: base.c * (1 - i / (STEPS * 1.5)), h: base.h });
      const ratio = await measureContrast(project, surface, { ...text, fill: 'color', color }, ink, packs);
      if (ratio === undefined) return null;
      const passes = ratio >= target;
      // Prefer the smallest change that passes; otherwise remember the strongest result.
      if (passes && (!best || best.ratio < target || i < best.step)) best = { color, ratio, step: i };
      else if (!passes && (!best || (best.ratio < target && ratio > best.ratio))) best = { color, ratio, step: i };
      if (passes) break;
    }
  }
  return best && { color: best.color, ratio: best.ratio };
}
