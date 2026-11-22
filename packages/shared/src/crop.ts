/**
 * Resolution-independent photo placement + face-aware smart crop.
 *
 * Crop is stored as { cx, cy, zoom }: the image point (normalized) that sits at the frame
 * centre, and zoom relative to "cover". Because it never stores pixels, swapping a 1600px
 * preview for a 50MP original produces exactly the same framing.
 */
import type { CropState, FaceBox } from './types';

export interface Placement {
  /** Inches relative to the frame's top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MAX_ZOOM = 8;

export function coverScale(frameW: number, frameH: number, imgW: number, imgH: number) {
  return Math.max(frameW / Math.max(1, imgW), frameH / Math.max(1, imgH));
}

export function clampCrop(frameW: number, frameH: number, imgW: number, imgH: number, crop: CropState): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom || 1));
  const s = coverScale(frameW, frameH, imgW, imgH) * zoom;
  const dw = imgW * s, dh = imgH * s;
  const halfW = frameW / 2 / dw, halfH = frameH / 2 / dh;
  const cx = Math.min(1 - halfW, Math.max(halfW, isFinite(crop.cx) ? crop.cx : 0.5));
  const cy = Math.min(1 - halfH, Math.max(halfH, isFinite(crop.cy) ? crop.cy : 0.5));
  return { ...crop, zoom, cx, cy };
}

export function placeImage(frameW: number, frameH: number, imgW: number, imgH: number, crop: CropState): Placement {
  const c = clampCrop(frameW, frameH, imgW, imgH, crop);
  const s = coverScale(frameW, frameH, imgW, imgH) * c.zoom;
  const width = imgW * s, height = imgH * s;
  return { left: frameW / 2 - c.cx * width, top: frameH / 2 - c.cy * height, width, height };
}

/** Effective print resolution (pixels per inch) of the placed photo. */
export function effectiveDpi(frameW: number, frameH: number, imgW: number, imgH: number, zoom: number) {
  return 1 / (coverScale(frameW, frameH, imgW, imgH) * Math.max(1, zoom));
}

export interface SmartCropOptions {
  frameW: number;
  frameH: number;
  imgW: number;
  imgH: number;
  faces?: FaceBox[] | null;
  focus?: { x: number; y: number } | null;
  /** Normalized region of the frame where faces should land (e.g. above an overlaid title). */
  focusArea?: { x: number; y: number; w: number; h: number } | null;
  /** Inches inside the frame faces must avoid (frame edges that touch the card trim). */
  insets?: { left: number; top: number; right: number; bottom: number };
  /** Avoid zooming below this effective DPI. */
  minDpi?: number;
  allowZoom?: boolean;
}

export interface SmartCropResult extends CropState {
  facesFit: boolean;
  usedFaces: number;
}

/** Faces that matter: drop tiny background faces relative to the largest. */
export function significantFaces(faces: FaceBox[] | null | undefined, imgW: number, imgH: number): FaceBox[] {
  if (!faces?.length) return [];
  const area = (f: FaceBox) => f.w * imgW * f.h * imgH;
  const maxA = Math.max(...faces.map(area));
  return faces.filter((f) => area(f) >= maxA * 0.18);
}

/** Expand a face box to a "head" box (hair/headroom above, chin below). Normalized coords. */
export function headBox(f: FaceBox) {
  return {
    x1: Math.max(0, f.x - f.w * 0.28),
    x2: Math.min(1, f.x + f.w * 1.28),
    y1: Math.max(0, f.y - f.h * 0.62),
    y2: Math.min(1, f.y + f.h * 1.3),
  };
}

export function smartCrop(o: SmartCropOptions): SmartCropResult {
  const { frameW, frameH, imgW, imgH } = o;
  const ins = o.insets ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const fa = o.focusArea ?? { x: 0, y: 0, w: 1, h: 1 };
  // Target region (frame inches)
  let tx = Math.max(ins.left, fa.x * frameW);
  let ty = Math.max(ins.top, fa.y * frameH);
  let tx2 = Math.min(frameW - ins.right, (fa.x + fa.w) * frameW);
  let ty2 = Math.min(frameH - ins.bottom, (fa.y + fa.h) * frameH);
  if (tx2 - tx < frameW * 0.25) { tx = ins.left; tx2 = frameW - ins.right; }
  if (ty2 - ty < frameH * 0.25) { ty = ins.top; ty2 = frameH - ins.bottom; }
  const tw = tx2 - tx, th = ty2 - ty;

  const s1 = coverScale(frameW, frameH, imgW, imgH); // inches per source px at zoom 1
  const faces = significantFaces(o.faces, imgW, imgH);

  let zoom = 1;
  let ux1 = 0.5, ux2 = 0.5, uy1 = 0.45, uy2 = 0.45, eye = 0.45;
  if (faces.length) {
    const boxes = faces.map(headBox);
    ux1 = Math.min(...boxes.map((b) => b.x1));
    ux2 = Math.max(...boxes.map((b) => b.x2));
    uy1 = Math.min(...boxes.map((b) => b.y1));
    uy2 = Math.max(...boxes.map((b) => b.y2));
    eye = faces.reduce((acc, f) => acc + f.y + f.h * 0.42, 0) / faces.length;
    if (o.allowZoom !== false) {
      const uwIn = (ux2 - ux1) * imgW * s1;
      const uhIn = (uy2 - uy1) * imgH * s1;
      const fill = Math.max(uwIn / tw, uhIn / th);
      if (fill < 0.32) {
        const maxByDpi = o.minDpi ? 1 / (o.minDpi * s1) : 1.6;
        zoom = Math.max(1, Math.min(1.6, maxByDpi, 0.5 / Math.max(0.05, fill)));
      }
    }
  } else if (o.focus) {
    ux1 = ux2 = o.focus.x;
    uy1 = uy2 = eye = o.focus.y;
  }

  const s = s1 * zoom;
  const dw = imgW * s, dh = imgH * s;
  // Horizontal: centre the union in the target region.
  let left = tx + tw / 2 - ((ux1 + ux2) / 2) * dw;
  // Vertical: eye line near the upper third for small groups; centred for large unions.
  const unionH = (uy2 - uy1) * dh;
  const eyeTarget = faces.length && unionH < th * 0.6 ? ty + th * 0.38 : ty + th / 2;
  let top = faces.length ? eyeTarget - eye * dh : ty + th * 0.48 - eye * dh;
  if (faces.length && unionH >= th * 0.6) top = ty + th / 2 - ((uy1 + uy2) / 2) * dh;

  // Keep the union inside the target region when possible.
  const fitClamp = (v: number, lo: number, hi: number) => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
  if (faces.length) {
    left = fitClamp(left, tx + tw - ux2 * dw, tx - ux1 * dw);
    top = fitClamp(top, ty + th - uy2 * dh, ty - uy1 * dh);
  }
  // Keep the image covering the frame.
  left = Math.min(0, Math.max(frameW - dw, left));
  top = Math.min(0, Math.max(frameH - dh, top));

  const facesFit =
    !faces.length ||
    (left + ux1 * dw >= tx - 1e-3 && left + ux2 * dw <= tx2 + 1e-3 && top + uy1 * dh >= ty - 1e-3 && top + uy2 * dh <= ty2 + 1e-3);

  return {
    cx: (frameW / 2 - left) / dw,
    cy: (frameH / 2 - top) / dh,
    zoom,
    mode: 'auto',
    facesFit,
    usedFaces: faces.length,
  };
}

/** Map normalized face boxes into card inches for a placed photo frame (unrotated). */
export function facesOnCard(
  frame: { x: number; y: number; w: number; h: number },
  imgW: number,
  imgH: number,
  crop: CropState,
  faces: FaceBox[],
) {
  const p = placeImage(frame.w, frame.h, imgW, imgH, crop);
  return faces.map((f) => ({
    x: frame.x + p.left + f.x * p.width,
    y: frame.y + p.top + f.y * p.height,
    w: f.w * p.width,
    h: f.h * p.height,
    personName: f.personName,
  }));
}
