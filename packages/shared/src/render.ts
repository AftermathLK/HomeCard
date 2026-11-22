/**
 * Render-job contract between the server (headless Chromium driver) and /render.html (the same
 * React CardSurface the editor uses). Page geometry is computed here so it is unit-testable and
 * identical for PNG/JPEG/PDF output.
 */
import { CROP_MARK_LENGTH_IN, CROP_MARK_OFFSET_IN, pageBox, SURFACE_INFO, type RectIn } from './formats';
import type { CardFormat, CardProject, ExportOptions, SurfaceId } from './types';

export interface RenderPanel {
  surface: SurfaceId;
  /** Trim origin (top-left of the finished surface) in PAGE inches. */
  x: number;
  y: number;
  /** Rotation about the trim centre (top-fold spreads print the back upside-down). */
  rotate: 0 | 180;
  /** Visible window of this panel on the page (page inches) — trim + bleed on outer edges only. */
  window: RectIn;
}

export interface RenderMark {
  kind: 'crop' | 'fold';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RenderPageSpec {
  /** File-name stem: "front", "back", "spread-outside", ... */
  name: string;
  label: string;
  widthIn: number;
  heightIn: number;
  /** Finished-size box in page coordinates (becomes the PDF TrimBox). */
  trim: RectIn;
  /** Trim + bleed in page coordinates (becomes the PDF BleedBox). */
  bleed: RectIn;
  panels: RenderPanel[];
  marks: RenderMark[];
  surfaces: SurfaceId[];
}

export interface RenderJob {
  id: string;
  project: CardProject;
  pages: RenderPageSpec[];
  dpi: number;
  /** "print": full-resolution sources resized to the exact device pixels; "preview": cached previews (thumbnails). */
  images: 'print' | 'preview';
  createdAt: string;
}

export interface RenderPhotoReport {
  page: string;
  surface: SurfaceId;
  elementId: string;
  ref: string;
  name: string;
  /** Pixel width requested from /api/media/print (exact device pixels of the drawn image). */
  requestedPx: number;
  /** Pixel width actually delivered (smaller when the original is smaller — never upscaled). */
  deliveredPx: number;
  sourceWidth: number;
  /** Real pixels per printed inch of the drawn image. */
  effectiveDpi: number;
  via: string;
}

export interface RenderReport {
  photos: RenderPhotoReport[];
  fonts: { requested: string[]; missing: string[] };
  failedImages: string[];
  warnings: string[];
  durationMs: number;
}

/** Written by /render.html to window.__HC_RENDER__ — polled by the server. */
export interface RenderPageState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  report?: RenderReport;
}

export interface BuildPagesOptions {
  surfaces: SurfaceId[];
  includeBleed: boolean;
  cropMarks: boolean;
  layout: ExportOptions['layout'];
}

const MARK_GAP_IN = CROP_MARK_OFFSET_IN;

function cropMarks(trim: RectIn, bleed: number, pageW: number, pageH: number): RenderMark[] {
  const off = bleed + MARK_GAP_IN;
  const len = CROP_MARK_LENGTH_IN;
  const xs = [trim.x, trim.x + trim.w];
  const ys = [trim.y, trim.y + trim.h];
  const marks: RenderMark[] = [];
  const cl = (v: number, max: number) => Math.max(0, Math.min(max, v));
  for (const x of xs) {
    marks.push({ kind: 'crop', x1: x, y1: cl(trim.y - off - len, pageH), x2: x, y2: cl(trim.y - off, pageH) });
    marks.push({ kind: 'crop', x1: x, y1: cl(trim.y + trim.h + off, pageH), x2: x, y2: cl(trim.y + trim.h + off + len, pageH) });
  }
  for (const y of ys) {
    marks.push({ kind: 'crop', x1: cl(trim.x - off - len, pageW), y1: y, x2: cl(trim.x - off, pageW), y2: y });
    marks.push({ kind: 'crop', x1: cl(trim.x + trim.w + off, pageW), y1: y, x2: cl(trim.x + trim.w + off + len, pageW), y2: y });
  }
  return marks;
}

function foldMarks(axis: 'x' | 'y', at: number, trim: RectIn, bleed: number, pageW: number, pageH: number): RenderMark[] {
  const off = bleed + MARK_GAP_IN;
  const len = CROP_MARK_LENGTH_IN;
  if (axis === 'x')
    return [
      { kind: 'fold', x1: at, y1: Math.max(0, trim.y - off - len), x2: at, y2: Math.max(0, trim.y - off) },
      { kind: 'fold', x1: at, y1: Math.min(pageH, trim.y + trim.h + off), x2: at, y2: Math.min(pageH, trim.y + trim.h + off + len) },
    ];
  return [
    { kind: 'fold', x1: Math.max(0, trim.x - off - len), y1: at, x2: Math.max(0, trim.x - off), y2: at },
    { kind: 'fold', x1: Math.min(pageW, trim.x + trim.w + off), y1: at, x2: Math.min(pageW, trim.x + trim.w + off + len), y2: at },
  ];
}

/** True when a folded card of this format folds along its left edge (portrait / square). */
export function isSideFold(f: Pick<CardFormat, 'widthIn' | 'heightIn'>) {
  return f.widthIn <= f.heightIn + 1e-6;
}

export function buildRenderPages(format: CardFormat, opts: BuildPagesOptions): RenderPageSpec[] {
  const { widthIn: w, heightIn: h } = format;
  const pb = pageBox(format, { includeBleed: opts.includeBleed, cropMarks: opts.cropMarks });
  const b = pb.bleed;
  const pad = pb.pad;
  const pages: RenderPageSpec[] = [];
  const want = new Set(opts.surfaces);

  if (opts.layout === 'spreads' && format.fold === 'folded') {
    const side = isSideFold(format);
    const spreadW = side ? 2 * w : w;
    const spreadH = side ? h : 2 * h;
    const pageW = spreadW + 2 * pad;
    const pageH = spreadH + 2 * pad;
    const trim = { x: pad, y: pad, w: spreadW, h: spreadH };
    const bleed = { x: pad - b, y: pad - b, w: spreadW + 2 * b, h: spreadH + 2 * b };
    const defs: Array<{ name: string; label: string; first: SurfaceId; second: SurfaceId }> = [
      { name: 'spread-outside', label: side ? 'Outside spread (back | front)' : 'Outside spread (back / front)', first: 'back', second: 'front' },
      { name: 'spread-inside', label: side ? 'Inside spread (left | right)' : 'Inside spread (top / bottom)', first: 'inside-left', second: 'inside-right' },
    ];
    for (const d of defs) {
      if (!want.has(d.first) && !want.has(d.second)) continue;
      const panels: RenderPanel[] = side
        ? [
            { surface: d.first, x: pad, y: pad, rotate: 0, window: { x: pad - b, y: pad - b, w: w + b, h: h + 2 * b } },
            { surface: d.second, x: pad + w, y: pad, rotate: 0, window: { x: pad + w, y: pad - b, w: w + b, h: h + 2 * b } },
          ]
        : [
            // Top-fold (tent) cards: the outside back prints upside-down above the front so it reads correctly when folded.
            { surface: d.first, x: pad, y: pad, rotate: d.name === 'spread-outside' ? 180 : 0, window: { x: pad - b, y: pad - b, w: w + 2 * b, h: h + b } },
            { surface: d.second, x: pad, y: pad + h, rotate: 0, window: { x: pad - b, y: pad + h, w: w + 2 * b, h: h + b } },
          ];
      pages.push({
        name: d.name,
        label: d.label,
        widthIn: pageW,
        heightIn: pageH,
        trim,
        bleed,
        panels,
        marks: opts.cropMarks
          ? [...cropMarks(trim, b, pageW, pageH), ...foldMarks(side ? 'x' : 'y', side ? pad + w : pad + h, trim, b, pageW, pageH)]
          : [],
        surfaces: [d.first, d.second],
      });
    }
    return pages;
  }

  for (const s of opts.surfaces) {
    const trim = { x: pad, y: pad, w, h };
    pages.push({
      name: s,
      label: SURFACE_INFO[s].label,
      widthIn: pb.widthIn,
      heightIn: pb.heightIn,
      trim,
      bleed: { x: pad - b, y: pad - b, w: w + 2 * b, h: h + 2 * b },
      panels: [{ surface: s, x: pad, y: pad, rotate: 0, window: { x: pad - b, y: pad - b, w: w + 2 * b, h: h + 2 * b } }],
      marks: opts.cropMarks ? cropMarks(trim, b, pb.widthIn, pb.heightIn) : [],
      surfaces: [s],
    });
  }
  return pages;
}

/** Exact output pixels for a page at a given DPI. */
export function pagePixels(page: Pick<RenderPageSpec, 'widthIn' | 'heightIn'>, dpi: number) {
  return { w: Math.round(page.widthIn * dpi), h: Math.round(page.heightIn * dpi) };
}

/** DPI that makes the short edge of the trim exactly `px` pixels (Digital Share Pack). */
export function shareDpi(format: Pick<CardFormat, 'widthIn' | 'heightIn'>, px = 1080) {
  return px / Math.min(format.widthIn, format.heightIn);
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'pdf',
  surfaces: ['front', 'back'],
  includeBleed: true,
  cropMarks: false,
  colorProfile: 'srgb',
  iccProfile: null,
  layout: 'panels',
  jpegQuality: 100,
  shareFormat: 'jpeg',
  dpi: 300,
};
