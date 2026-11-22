import type { CardFormat, MaskShape, PhotoElement } from './types';
import { CSS_PX_PER_IN } from './units';

/** Photo content box (inches) relative to the element's own top-left, accounting for frame styles. */
export function photoContentBox(el: Pick<PhotoElement, 'w' | 'h' | 'frameStyle'>) {
  if (el.frameStyle === 'polaroid') {
    const side = el.w * 0.06;
    const bottom = Math.min(el.h * 0.3, el.w * 0.22);
    return { x: side, y: side, w: el.w - 2 * side, h: el.h - side - bottom };
  }
  if (el.frameStyle === 'mat') {
    const pad = Math.min(el.w, el.h) * 0.07;
    return { x: pad, y: pad, w: el.w - 2 * pad, h: el.h - 2 * pad };
  }
  return { x: 0, y: 0, w: el.w, h: el.h };
}

/** Distance (inches) from each edge of a photo's content box to the card's safe line, when it crosses it. */
export function photoSafeInsets(el: PhotoElement, format: CardFormat) {
  const box = photoContentBox(el);
  const x = el.x + box.x, y = el.y + box.y;
  const s = format.safeIn;
  // Rotated frames: skip insets (decorative polaroids rarely touch the trim).
  if (el.rotation) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.max(0, s - x),
    top: Math.max(0, s - y),
    right: Math.max(0, x + box.w - (format.widthIn - s)),
    bottom: Math.max(0, y + box.h - (format.heightIn - s)),
  };
}

const f = (v: number) => Math.round(v * 100) / 100;

/** Normalized heart outline (0..1). */
const HEART: Array<[string, number[]]> = [
  ['M', [0.5, 1]],
  ['C', [0.18, 0.74, 0, 0.52, 0, 0.3]],
  ['C', [0, 0.12, 0.13, 0, 0.28, 0]],
  ['C', [0.38, 0, 0.46, 0.06, 0.5, 0.16]],
  ['C', [0.54, 0.06, 0.62, 0, 0.72, 0]],
  ['C', [0.87, 0, 1, 0.12, 1, 0.3]],
  ['C', [1, 0.52, 0.82, 0.74, 0.5, 1]],
];

/**
 * Clip path for a mask, in CSS px of the content box (w × h px). Returns null when the mask
 * is better expressed with border-radius (rect/rounded/circle/ellipse).
 */
export function maskPath(shape: MaskShape, wPx: number, hPx: number): { d: string; evenodd?: boolean } | null {
  switch (shape) {
    case 'arch': {
      const r = Math.min(wPx / 2, hPx);
      return { d: `M0 ${f(hPx)} V${f(r)} A${f(wPx / 2)} ${f(r)} 0 0 1 ${f(wPx)} ${f(r)} V${f(hPx)}Z` };
    }
    case 'heart': {
      return {
        d:
          HEART.map(([c, pts]) => {
            const out: string[] = [];
            for (let i = 0; i < pts.length; i += 2) out.push(`${f(pts[i] * wPx)} ${f(pts[i + 1] * hPx)}`);
            return c + out.join(' ');
          }).join(' ') + 'Z',
      };
    }
    case 'scallop': {
      const t = Math.min(wPx, hPx) / 22;
      const nx = Math.max(3, Math.round((wPx - 2 * t) / (2 * t)));
      const ny = Math.max(3, Math.round((hPx - 2 * t) / (2 * t)));
      const rx = (wPx - 2 * t) / (2 * nx);
      const ry = (hPx - 2 * t) / (2 * ny);
      let d = `M${f(t)} ${f(t)}`;
      for (let i = 0; i < nx; i++) d += ` A${f(rx)} ${f(t)} 0 0 1 ${f(t + rx * 2 * (i + 1))} ${f(t)}`;
      for (let i = 0; i < ny; i++) d += ` A${f(t)} ${f(ry)} 0 0 1 ${f(wPx - t)} ${f(t + ry * 2 * (i + 1))}`;
      for (let i = 0; i < nx; i++) d += ` A${f(rx)} ${f(t)} 0 0 1 ${f(wPx - t - rx * 2 * (i + 1))} ${f(hPx - t)}`;
      for (let i = 0; i < ny; i++) d += ` A${f(t)} ${f(ry)} 0 0 1 ${f(t)} ${f(hPx - t - ry * 2 * (i + 1))}`;
      return { d: d + 'Z' };
    }
    case 'stamp': {
      const r = Math.min(wPx, hPx) / 40;
      const step = r * 3.2;
      let d = `M0 0 H${f(wPx)} V${f(hPx)} H0Z`;
      const hole = (cx: number, cy: number) =>
        ` M${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
      const nx = Math.floor(wPx / step), ny = Math.floor(hPx / step);
      const ox = (wPx - (nx - 1) * step) / 2, oy = (hPx - (ny - 1) * step) / 2;
      for (let i = 0; i < nx; i++) d += hole(ox + i * step, 0) + hole(ox + i * step, hPx);
      for (let i = 0; i < ny; i++) d += hole(0, oy + i * step) + hole(wPx, oy + i * step);
      return { d, evenodd: true };
    }
    default:
      return null;
  }
}

export const MASK_LABELS: Record<MaskShape, string> = {
  rect: 'Square corners',
  rounded: 'Rounded',
  circle: 'Circle',
  ellipse: 'Oval',
  arch: 'Arch',
  scallop: 'Scalloped',
  heart: 'Heart',
  stamp: 'Postage stamp',
};

export const inPx = (v: number) => v * CSS_PX_PER_IN;
