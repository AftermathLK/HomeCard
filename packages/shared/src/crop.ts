/**
 * Resolution-independent photo placement + face-aware smart crop.
 *
 * Crop is stored as { cx, cy, zoom }: the image point (normalized) that sits at the frame
 * centre, and zoom relative to "cover". Because it never stores pixels, swapping a 1600px
 * preview for a 50MP original produces exactly the same framing.
 */
import type { CropState, FaceBox, PhotoFill } from './types';

export interface Placement {
  /** Inches relative to the frame's top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MAX_ZOOM = 8;
/** Largest straighten angle, either way (degrees). */
export const MAX_STRAIGHTEN = 45;

/** A straighten angle made safe: finite, within ±MAX_STRAIGHTEN, to 0.1°. */
export function straightenAngle(angle: number | undefined | null): number {
  if (!angle || !isFinite(angle)) return 0;
  return Math.round(Math.max(-MAX_STRAIGHTEN, Math.min(MAX_STRAIGHTEN, angle)) * 10) / 10;
}

/**
 * The box a photo straightened by `angle` must cover: the frame's bounding box once turned into
 * the photo's axes. Covering it guarantees no empty corners show in the frame.
 */
export function straightenBox(frameW: number, frameH: number, angle?: number | null) {
  const a = straightenAngle(angle);
  if (!a) return { w: frameW, h: frameH };
  const t = (Math.abs(a) * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return { w: frameW * c + frameH * s, h: frameW * s + frameH * c };
}

/* ---------------- Turn & mirror ---------------- */

export type QuarterTurn = 0 | 90 | 180 | 270;
/** How the user turned a photo inside its frame: mirror left-right first, then turn clockwise. */
export interface FillOrientation {
  rotate?: QuarterTurn;
  flipX?: boolean;
}
export type TurnOp = 'cw' | 'ccw' | 'flipH' | 'flipV';

const quarter = (deg: number) => ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as QuarterTurn;
const turnOf = (o: FillOrientation) => quarter(o.rotate ?? 0);

export function isTurned(o: FillOrientation) {
  return turnOf(o) !== 0 || !!o.flipX;
}

/** A normalized point of the original photo → where it shows after the mirror + turn. */
export function orientPoint(x: number, y: number, o: FillOrientation): [number, number] {
  const u = o.flipX ? 1 - x : x;
  switch (turnOf(o)) {
    case 90: return [1 - y, u];
    case 180: return [1 - u, 1 - y];
    case 270: return [y, 1 - u];
    default: return [u, y];
  }
}

/** Inverse of `orientPoint`: a point of the turned photo → the original photo. */
export function unorientPoint(x: number, y: number, o: FillOrientation): [number, number] {
  let u: number, v: number;
  switch (turnOf(o)) {
    case 90: u = y; v = 1 - x; break;
    case 180: u = 1 - x; v = 1 - y; break;
    case 270: u = 1 - y; v = x; break;
    default: u = x; v = y;
  }
  return [o.flipX ? 1 - u : u, v];
}

function orientFace(f: FaceBox, o: FillOrientation): FaceBox {
  const [ax, ay] = orientPoint(f.x, f.y, o);
  const [bx, by] = orientPoint(f.x + f.w, f.y + f.h, o);
  return { ...f, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/**
 * The photo as it appears in the frame after the user's turn/mirror: pixel size and
 * faces/focus in turned space. All crop math (placeImage, smartCrop, DPI) uses this.
 */
export function orientedFill(fill: Pick<PhotoFill, 'width' | 'height' | 'faces' | 'focus' | 'rotate' | 'flipX'>): {
  width: number;
  height: number;
  faces?: FaceBox[];
  focus?: { x: number; y: number };
} {
  if (!isTurned(fill)) return fill;
  const side = turnOf(fill) % 180 !== 0;
  const focus = fill.focus ? orientPoint(fill.focus.x, fill.focus.y, fill) : null;
  return {
    width: side ? fill.height : fill.width,
    height: side ? fill.width : fill.height,
    faces: fill.faces?.map((f) => orientFace(f, fill)),
    focus: focus ? { x: focus[0], y: focus[1] } : undefined,
  };
}

/** The orientation after one more user step, expressed in the canonical mirror-then-turn form. */
export function turnOrientation(o: FillOrientation, op: TurnOp): { rotate: QuarterTurn; flipX: boolean } {
  const r = turnOf(o), f = !!o.flipX;
  switch (op) {
    case 'cw': return { rotate: quarter(r + 90), flipX: f };
    case 'ccw': return { rotate: quarter(r - 90), flipX: f };
    case 'flipH': return { rotate: quarter(-r), flipX: !f };
    case 'flipV': return { rotate: quarter(180 - r), flipX: !f };
  }
}

/**
 * Turn or mirror a fill, keeping the same part of the photo at the frame centre. The crop is
 * not re-clamped here: run the result through `fitFill` (or `clampCrop`) for its frame.
 */
export function turnFill<T extends PhotoFill>(fill: T, op: TurnOp | 'reset'): T {
  const next = op === 'reset' ? { rotate: 0 as QuarterTurn, flipX: false } : turnOrientation(fill, op);
  const [ox, oy] = unorientPoint(fill.crop.cx, fill.crop.cy, fill);
  const [cx, cy] = orientPoint(ox, oy, next);
  const out: T = { ...fill, crop: { ...fill.crop, cx, cy } };
  // A mirror reverses which way the photo leans; a reset puts it straight.
  if (op === 'reset') delete out.crop.angle;
  else if ((op === 'flipH' || op === 'flipV') && out.crop.angle) out.crop.angle = -out.crop.angle;
  if (next.rotate) out.rotate = next.rotate;
  else delete out.rotate;
  if (next.flipX) out.flipX = true;
  else delete out.flipX;
  return out;
}

/**
 * Where to draw the un-turned image so that, with `transform` (about its centre), it covers
 * `place` (the placement computed from `orientedFill`). Width is along the image's own x axis,
 * so `width × dpi` is the pixel width to request for print.
 */
export function imageBox(place: Placement, o: FillOrientation): Placement & { transform?: string } {
  const t = turnOf(o);
  const side = t % 180 !== 0;
  const width = side ? place.height : place.width;
  const height = side ? place.width : place.height;
  const parts = [t ? `rotate(${t}deg)` : '', o.flipX ? 'scaleX(-1)' : ''].filter(Boolean);
  return {
    left: place.left + (place.width - width) / 2,
    top: place.top + (place.height - height) / 2,
    width,
    height,
    transform: parts.length ? parts.join(' ') : undefined,
  };
}

export function coverScale(frameW: number, frameH: number, imgW: number, imgH: number) {
  return Math.max(frameW / Math.max(1, imgW), frameH / Math.max(1, imgH));
}

export function clampCrop(frameW: number, frameH: number, imgW: number, imgH: number, crop: CropState): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom || 1));
  const angle = straightenAngle(crop.angle);
  const b = straightenBox(frameW, frameH, angle);
  const s = coverScale(b.w, b.h, imgW, imgH) * zoom;
  const dw = imgW * s, dh = imgH * s;
  const halfW = b.w / 2 / dw, halfH = b.h / 2 / dh;
  const cx = Math.min(1 - halfW, Math.max(halfW, isFinite(crop.cx) ? crop.cx : 0.5));
  const cy = Math.min(1 - halfH, Math.max(halfH, isFinite(crop.cy) ? crop.cy : 0.5));
  const out: CropState = { ...crop, zoom, cx, cy };
  if (angle) out.angle = angle;
  else delete out.angle;
  return out;
}

export function placeImage(frameW: number, frameH: number, imgW: number, imgH: number, crop: CropState): Placement {
  const c = clampCrop(frameW, frameH, imgW, imgH, crop);
  const b = straightenBox(frameW, frameH, c.angle);
  const s = coverScale(b.w, b.h, imgW, imgH) * c.zoom;
  const width = imgW * s, height = imgH * s;
  // Positioned as if straight; a straightened photo is then turned by c.angle about the frame centre.
  return { left: frameW / 2 - c.cx * width, top: frameH / 2 - c.cy * height, width, height };
}

/** Effective print resolution (pixels per inch) of the placed photo. */
export function effectiveDpi(frameW: number, frameH: number, imgW: number, imgH: number, zoom: number, angle?: number | null) {
  const b = straightenBox(frameW, frameH, angle);
  return 1 / (coverScale(b.w, b.h, imgW, imgH) * Math.max(1, zoom));
}

/** A point in frame inches → where it falls on the straight (un-straightened) placement. */
export function unstraightenPoint(x: number, y: number, frameW: number, frameH: number, angle?: number | null): [number, number] {
  const a = straightenAngle(angle);
  if (!a) return [x, y];
  const t = (-a * Math.PI) / 180;
  const dx = x - frameW / 2, dy = y - frameH / 2;
  return [frameW / 2 + dx * Math.cos(t) - dy * Math.sin(t), frameH / 2 + dx * Math.sin(t) + dy * Math.cos(t)];
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
