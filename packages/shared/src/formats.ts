import type { CardFormat, FoldType, Orientation, SurfaceId } from './types';
import { MM_PER_IN, type LengthUnit } from './units';

export interface CardSize {
  id: string;
  name: string;
  /** Portrait dimensions (w <= h) in inches. */
  w: number;
  h: number;
  description: string;
  orientations: Array<'portrait' | 'landscape'>;
  /** Badged "Most popular" for people who measure in this unit. */
  popularFor?: LengthUnit;
  /** An ISO (metric) size: named by paper size, made in millimetres. */
  metric?: boolean;
  /** One of the person's own saved sizes. */
  saved?: boolean;
}

const mm = (v: number) => v / MM_PER_IN;

export const CARD_SIZES: CardSize[] = [
  { id: '5x7', name: '5 × 7"', w: 5, h: 7, description: 'The classic holiday card. Fits A7 envelopes.', orientations: ['portrait', 'landscape'], popularFor: 'in' },
  { id: '4x8', name: '4 × 8" Photo Card', w: 4, h: 8, description: 'Tall/wide photo-card format. Fits #10-style slim envelopes.', orientations: ['portrait', 'landscape'] },
  { id: '5x5', name: '5 × 5" Square', w: 5, h: 5, description: 'Modern square card. Needs a square envelope (extra postage in the US).', orientations: ['portrait'] },
  { id: 'a2', name: 'A2 note card', w: 4.25, h: 5.5, description: 'Note-card size. Fits A2 envelopes; a letter sheet folds into it.', orientations: ['portrait', 'landscape'] },
  { id: '6x8', name: '6 × 8"', w: 6, h: 8, description: 'Large statement card.', orientations: ['portrait', 'landscape'] },
  { id: '4x6', name: '4 × 6" Postcard', w: 4, h: 6, description: 'Postcard / budget photo print size.', orientations: ['portrait', 'landscape'] },
  { id: 'a6', name: 'A6', w: mm(105), h: mm(148), description: 'The standard UK and European greeting card (105 × 148 mm). Fits C6 envelopes; folded, it prints on an A5 sheet.', orientations: ['portrait', 'landscape'], popularFor: 'mm', metric: true },
  { id: 'a5', name: 'A5', w: mm(148), h: mm(210), description: 'Large greeting card (148 × 210 mm). Fits C5 envelopes; folded, it prints on an A4 sheet.', orientations: ['portrait', 'landscape'], metric: true },
  { id: 'a4', name: 'A4', w: mm(210), h: mm(297), description: 'Poster-size card, invitation or certificate (210 × 297 mm). Fits C4 envelopes.', orientations: ['portrait', 'landscape'], metric: true },
  { id: 'dl', name: 'DL', w: mm(99), h: mm(210), description: 'Slim card (99 × 210 mm), a third of an A4 sheet. Fits DL envelopes.', orientations: ['portrait', 'landscape'], metric: true },
  { id: 'sq150', name: 'Square 150 mm', w: mm(150), h: mm(150), description: 'Popular square card (150 × 150 mm). Fits 155 or 160 mm square envelopes.', orientations: ['portrait'], metric: true },
  { id: 'custom', name: 'Custom size', w: 5, h: 7, description: 'Any finished size from 2" to 14".', orientations: ['portrait', 'landscape'] },
];

/* ---------- Saved sizes (per person) ---------- */

/** A card size someone named and saved for their own card stock: portrait (w <= h), in inches. */
export interface SavedCardSize {
  id: string;
  name: string;
  w: number;
  h: number;
}

export const MIN_CARD_IN = 2;
export const MAX_CARD_IN = 14;
export const MAX_SAVED_SIZES = 30;
/** A card made at a saved size keeps `sizeId: 'saved:<id>'` (and its own width and height). */
export const SAVED_SIZE_PREFIX = 'saved:';
export const SAVED_SIZE_ID_RE = /^[a-z0-9]{1,24}$/;

/** Sizes typed in by hand: "Custom size" and the person's saved sizes. */
export const isCustomSizeId = (id: string) => id === 'custom' || id.startsWith(SAVED_SIZE_PREFIX);

export function savedSizeOption(s: SavedCardSize): CardSize {
  return {
    id: SAVED_SIZE_PREFIX + s.id,
    name: s.name,
    w: s.w,
    h: s.h,
    description: 'One of your saved sizes.',
    orientations: Math.abs(s.w - s.h) < 1e-6 ? ['portrait'] : ['portrait', 'landscape'],
    saved: true,
  };
}

/** A built-in size or one of the person's saved sizes, by id. */
export function findCardSize(id: string, saved: readonly SavedCardSize[] = []): CardSize | undefined {
  if (id.startsWith(SAVED_SIZE_PREFIX)) {
    const s = saved.find((x) => SAVED_SIZE_PREFIX + x.id === id);
    return s && savedSizeOption(s);
  }
  return CARD_SIZES.find((s) => s.id === id);
}

/** The sizes on the size picker until someone stars their own. */
export function defaultFavoriteSizes(unit: LengthUnit): string[] {
  return unit === 'mm' ? ['a6', 'a5', 'dl', 'sq150', '5x7', '4x6'] : ['5x7', '4x8', '5x5', 'a2', '6x8', '4x6'];
}

export interface VendorPreset {
  id: string;
  name: string;
  bleedIn: number;
  safeIn: number;
  colorProfile: 'srgb' | 'cmyk';
  recommendedFormat: 'png' | 'jpeg' | 'pdf';
  /** Upload portals with file-size caps (MB). */
  maxUploadMB?: number;
  supportsFolded: boolean;
  notes: string;
}

/**
 * Presets reflect commonly published upload specs. Vendors change these occasionally —
 * HomeCard shows the values so users can double-check against the vendor's current template.
 */
export const VENDOR_PRESETS: VendorPreset[] = [
  {
    id: 'generic',
    name: 'Generic 300 DPI (0.125" bleed)',
    bleedIn: 0.125,
    safeIn: 0.25,
    colorProfile: 'srgb',
    recommendedFormat: 'pdf',
    supportsFolded: true,
    notes: 'Industry-standard 1/8" bleed on every side, 1/4" safe margin. Works with most labs and local print shops.',
  },
  {
    id: 'mpix',
    name: 'Mpix',
    bleedIn: 0.125,
    safeIn: 0.25,
    colorProfile: 'srgb',
    recommendedFormat: 'jpeg',
    supportsFolded: true,
    notes: 'Upload sRGB JPEG/PNG at 300 DPI with 1/8" bleed. Keep text and faces 1/4" from the trim.',
  },
  {
    id: 'shutterfly',
    name: 'Shutterfly',
    bleedIn: 0.125,
    safeIn: 0.25,
    colorProfile: 'srgb',
    recommendedFormat: 'jpeg',
    maxUploadMB: 25,
    supportsFolded: true,
    notes: 'Upload-your-own-design cards accept sRGB JPEG with 1/8" bleed. Use JPEG if the file is over the upload limit.',
  },
  {
    id: 'walgreens',
    name: 'Walgreens / CVS / Costco (photo lab)',
    bleedIn: 0,
    safeIn: 0.2,
    colorProfile: 'srgb',
    recommendedFormat: 'jpeg',
    maxUploadMB: 20,
    supportsFolded: false,
    notes: 'Photo-lab prints are produced at the exact print size (no bleed). Choose "Fit/No crop" at checkout; labs may trim ~1–2% so keep a safe margin.',
  },
  {
    id: 'vistaprint',
    name: 'Vistaprint',
    bleedIn: 0.105,
    safeIn: 0.21,
    colorProfile: 'srgb',
    recommendedFormat: 'pdf',
    supportsFolded: true,
    notes: 'Vistaprint documents include ~0.105" bleed per side; keep critical content inside the safety line.',
  },
  {
    id: 'staples',
    name: 'Staples / FedEx Office',
    bleedIn: 0.125,
    safeIn: 0.25,
    colorProfile: 'cmyk',
    recommendedFormat: 'pdf',
    supportsFolded: true,
    notes: 'Print & copy centers prefer PDF with 1/8" bleed. CMYK conversion and crop marks are recommended for in-store production.',
  },
  {
    id: 'zazzle',
    name: 'Zazzle / Canva Print',
    bleedIn: 0.125,
    safeIn: 0.25,
    colorProfile: 'srgb',
    recommendedFormat: 'png',
    supportsFolded: true,
    notes: 'Upload a full-bleed PNG (or PDF) at 300 DPI; their editors show the bleed line for final adjustment.',
  },
  {
    id: 'home',
    name: 'Borderless Home Print',
    bleedIn: 0,
    safeIn: 0.2,
    colorProfile: 'srgb',
    recommendedFormat: 'png',
    supportsFolded: true,
    notes: 'Exports the exact card size. Borderless printers enlarge slightly, so a 0.2" safe margin protects text.',
  },
];

export const DEFAULT_VENDOR_ID = 'generic';
export const DEFAULT_SIZE_ID = '5x7';

export function getVendor(id: string): VendorPreset {
  return VENDOR_PRESETS.find((v) => v.id === id) ?? VENDOR_PRESETS[0];
}

export function getSize(id: string): CardSize {
  return CARD_SIZES.find((s) => s.id === id) ?? CARD_SIZES[0];
}

export function orientationOf(widthIn: number, heightIn: number): Orientation {
  const r = widthIn / heightIn;
  if (Math.abs(r - 1) < 0.04) return 'square';
  return r < 1 ? 'portrait' : 'landscape';
}

export function makeFormat(opts: {
  sizeId: string;
  orientation?: 'portrait' | 'landscape';
  vendorId?: string;
  fold?: FoldType;
  includeBack?: boolean;
  customW?: number;
  customH?: number;
}): CardFormat {
  const size = getSize(opts.sizeId);
  const vendor = getVendor(opts.vendorId ?? DEFAULT_VENDOR_ID);
  const custom = isCustomSizeId(opts.sizeId);
  let w = custom ? clampSize(opts.customW ?? size.w) : size.w;
  let h = custom ? clampSize(opts.customH ?? size.h) : size.h;
  if (!custom) {
    const wantLandscape = opts.orientation === 'landscape';
    if (wantLandscape && w < h) [w, h] = [h, w];
  }
  const savedId = opts.sizeId.slice(SAVED_SIZE_PREFIX.length);
  return {
    sizeId: !custom ? size.id : opts.sizeId.startsWith(SAVED_SIZE_PREFIX) && SAVED_SIZE_ID_RE.test(savedId) ? opts.sizeId : 'custom',
    widthIn: w,
    heightIn: h,
    bleedIn: vendor.bleedIn,
    safeIn: vendor.safeIn,
    fold: opts.fold ?? 'flat',
    vendorId: vendor.id,
    includeBack: opts.includeBack ?? true,
  };
}

export function clampSize(v: number) {
  return Math.min(MAX_CARD_IN, Math.max(MIN_CARD_IN, Math.round(v * 1000) / 1000));
}

export interface SurfaceInfo {
  id: SurfaceId;
  label: string;
  short: string;
}

export const SURFACE_INFO: Record<SurfaceId, SurfaceInfo> = {
  front: { id: 'front', label: 'Front', short: 'Front' },
  back: { id: 'back', label: 'Back', short: 'Back' },
  'inside-left': { id: 'inside-left', label: 'Inside Left', short: 'In-L' },
  'inside-right': { id: 'inside-right', label: 'Inside Right', short: 'In-R' },
};

export function surfacesFor(format: Pick<CardFormat, 'fold' | 'includeBack'>): SurfaceId[] {
  if (format.fold === 'folded') return ['front', 'inside-left', 'inside-right', 'back'];
  return format.includeBack ? ['front', 'back'] : ['front'];
}

/* ---------- Geometry helpers ---------- */

export interface RectIn {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function trimRect(f: CardFormat): RectIn {
  return { x: 0, y: 0, w: f.widthIn, h: f.heightIn };
}
export function bleedRect(f: CardFormat): RectIn {
  return { x: -f.bleedIn, y: -f.bleedIn, w: f.widthIn + 2 * f.bleedIn, h: f.heightIn + 2 * f.bleedIn };
}
export function safeRect(f: CardFormat): RectIn {
  return { x: f.safeIn, y: f.safeIn, w: f.widthIn - 2 * f.safeIn, h: f.heightIn - 2 * f.safeIn };
}

/** Crop-mark slug (space outside the bleed used for marks). */
export const CROP_MARK_SLUG_IN = 0.3;
export const CROP_MARK_LENGTH_IN = 0.2;
/** Gap between the bleed edge and the start of a crop mark (marks must never touch the bleed). */
export const CROP_MARK_OFFSET_IN = 0.0625;
/** Clear paper left between the outer end of a crop mark and the page edge. */
const CROP_MARK_MARGIN_IN = 0.0625;

/** Output page box for an export. */
export function pageBox(f: CardFormat, opts: { includeBleed: boolean; cropMarks: boolean }) {
  const bleed = opts.includeBleed ? f.bleedIn : 0;
  const slug = opts.cropMarks ? Math.max(CROP_MARK_SLUG_IN, bleed + CROP_MARK_OFFSET_IN + CROP_MARK_LENGTH_IN + CROP_MARK_MARGIN_IN) - bleed : 0;
  const pad = bleed + slug;
  return {
    /** Distance from page edge to trim edge. */
    pad,
    bleed,
    slug,
    widthIn: f.widthIn + 2 * pad,
    heightIn: f.heightIn + 2 * pad,
  };
}

export function pixelSize(widthIn: number, heightIn: number, dpi: number) {
  return { w: Math.round(widthIn * dpi), h: Math.round(heightIn * dpi) };
}

export function rectsIntersect(a: RectIn, b: RectIn) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(outer: RectIn, inner: RectIn, eps = 1e-4) {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

/** Axis-aligned bounds of a rect rotated about its centre. */
export function rotatedBounds(r: RectIn, deg: number): RectIn {
  if (!deg) return r;
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const w = r.w * c + r.h * s;
  const h = r.w * s + r.h * c;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
