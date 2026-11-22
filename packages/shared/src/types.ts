/**
 * HomeCard document model.
 *
 * All geometry is in INCHES relative to the TRIM origin (top-left of the finished card).
 * Negative coordinates / values beyond the trim size extend into the bleed.
 * Font sizes are in POINTS (1pt = 1/72in).
 */

import type { RenderReport } from './render';

export type SurfaceId = 'front' | 'back' | 'inside-left' | 'inside-right';
export type FoldType = 'flat' | 'folded';
export type Orientation = 'portrait' | 'landscape' | 'square';

/** Theme colour tokens. Elements reference these with an "@" prefix (e.g. "@accent"). */
export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  accent2: string;
  onPhoto: string;
  scrim: string;
}
export type ThemeColorToken = keyof ThemeColors;
/** "@accent" style token or a literal "#rrggbb" / "#rrggbbaa" colour. */
export type ColorRef = string;

export type FontRole = 'display' | 'body' | 'accent';
export interface FontSpec {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** Extra tracking in em. */
  letterSpacing?: number;
  transform?: 'none' | 'uppercase';
}

export interface Theme {
  paletteId?: string;
  paletteName?: string;
  colors: ThemeColors;
  pairingId?: string;
  fonts: Record<FontRole, FontSpec>;
  /** Foil id: built-in ('gold' | 'silver' | 'rose-gold' | 'copper') or style-pack foil "pack:<packId>/<foilId>". */
  foil: string;
}

export interface CardFormat {
  sizeId: string;
  /** Finished (trim) size in inches, already oriented. */
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  safeIn: number;
  fold: FoldType;
  vendorId: string;
  /** Flat cards only: whether a printed back is included. */
  includeBack: boolean;
}

export interface FaceBox {
  /** Normalized to the oriented image (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
  personName?: string;
}

export interface CropState {
  /** Image point (normalized 0..1) shown at the frame centre. */
  cx: number;
  cy: number;
  /** 1 = "cover" (image just fills the frame). >1 zooms in. */
  zoom: number;
  mode: 'auto' | 'manual';
}

export interface Adjustments {
  brightness: number; // -1..1
  contrast: number; // -1..1
  warmth: number; // -1..1
  tint: number; // -1..1 (green ↔ magenta)
  vibrance: number; // -1..1 (skin-tone protected)
  saturation: number; // -1..1
  shadows: number; // -1..1 (positive lifts shadows)
  highlights: number; // -1..1 (negative recovers highlights)
  fade: number; // 0..1 matte black lift
  grayscale: number; // 0..1
  sepia: number; // 0..1
  vignette: number; // 0..1 (rendered as a vector radial overlay)
  grain: number; // 0..1 (rendered as a physical-size texture overlay)
}

export interface PhotoPolish {
  /** Parameters computed by Auto-Enhance (null = off). */
  auto: Adjustments | null;
  filterId: string | null;
  filterStrength: number; // 0..1
  /** User slider offsets applied on top. */
  user: Adjustments;
}

export interface PhotoFill {
  ref: string;
  /** Oriented pixel size of the ORIGINAL asset (used for DPI + crop math). */
  width: number;
  height: number;
  faces?: FaceBox[];
  /** Saliency focal point (normalized), used when no faces. */
  focus?: { x: number; y: number };
  crop: CropState;
  polish: PhotoPolish;
}

export type MaskShape =
  | 'rect'
  | 'rounded'
  | 'circle'
  | 'ellipse'
  | 'arch'
  | 'scallop'
  | 'heart'
  | 'stamp';

export type TextRole =
  | 'headline'
  | 'subhead'
  | 'names'
  | 'year'
  | 'message'
  | 'body'
  | 'small'
  | 'monogram'
  | 'custom';

interface ElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  locked?: boolean;
  hidden?: boolean;
  name?: string;
  /** True when created by a template (re-generated on template switch). */
  managed?: boolean;
}

export interface PhotoElement extends ElementBase {
  type: 'photo';
  slot: number;
  fill: PhotoFill | null;
  mask: MaskShape;
  radius: number; // inches (rounded mask)
  border?: { width: number; color: ColorRef } | null;
  frameStyle: 'none' | 'polaroid' | 'mat';
  shadow: boolean;
  /** Normalized frame rect where faces should ideally land (e.g. above a text overlay). */
  focusArea?: { x: number; y: number; w: number; h: number };
}

export interface TextElement extends ElementBase {
  type: 'text';
  role: TextRole;
  text: string;
  fontRole: FontRole;
  /** Explicit override of the theme font. */
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
  fontSize: number; // pt
  lineHeight: number; // multiplier
  letterSpacing?: number; // em (overrides theme)
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  color: ColorRef;
  fill: 'color' | 'foil';
  transform?: 'none' | 'uppercase' | 'theme';
  shadow: boolean;
  /** Shrink-to-fit the box (never grows). */
  autoFit: boolean;
  isPlaceholder?: boolean;
}

export interface OrnamentElement extends ElementBase {
  type: 'ornament';
  /** "builtin:<id>" or "pack:<packId>/<relative.svg>" */
  asset: string;
  color: ColorRef;
  color2?: ColorRef;
  flipX?: boolean;
}

export interface StickerElement extends ElementBase {
  type: 'sticker';
  /** "pack:<packId>/<relative.png|svg>" */
  asset: string;
  flipX?: boolean;
}

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fill: ColorRef | null;
  stroke?: { width: number; color: ColorRef } | null;
  radius: number;
}

export interface ScrimElement extends ElementBase {
  type: 'scrim';
  direction: 'to-top' | 'to-bottom' | 'to-left' | 'to-right' | 'radial' | 'solid';
  color: ColorRef;
  strength: number; // 0..1 max alpha
  /** Fraction (0..1) of the box covered by the solid part before fading. */
  extent: number;
}

export type CardElement =
  | PhotoElement
  | TextElement
  | OrnamentElement
  | StickerElement
  | ShapeElement
  | ScrimElement;

export type CardElementType = CardElement['type'];

export interface SurfaceBackground {
  color: ColorRef;
  /** Background image/texture: "pack:<packId>/<file>" (style pack) or "stock:<file>" (downloaded stock image). */
  texture?: string | null;
  textureMode?: 'tile' | 'cover';
  textureScaleIn?: number;
  textureOpacity?: number;
  /** Pixel size of the texture image (stock backgrounds) — drives the resolution indicator. */
  textureWidth?: number;
  textureHeight?: number;
  /**
   * "Soften": the server upsamples the image to the exact print size (Lanczos) and applies a
   * gentle blur so a low-resolution scenic/bokeh photo prints smooth instead of pixelated.
   */
  soften?: boolean;
  /** Attribution line for stock images ("Photo by … on Unsplash"). */
  credit?: string | null;
  creditUrl?: string | null;
  /** Procedural vector backdrop drawn above the colour/texture (Pattern & Paper Studio). */
  backdrop?: BackdropSpec | null;
}

export type BackdropKind =
  | 'cardstock'
  | 'linen'
  | 'watercolor'
  | 'snowfall'
  | 'stars'
  | 'plaid'
  | 'deco-border'
  | 'scallop-frame'
  | 'radial-glow';

export interface BackdropSpec {
  kind: BackdropKind;
  /** Random seed — the same seed always draws the same pattern. */
  seed: number;
  /** 0..1 how much of the pattern is drawn. */
  density: number;
  /** 0.5..2 size of the motifs. */
  scale: number;
  /** 0..1 overall strength. */
  opacity: number;
  /**
   * Colours as theme tokens ("@accent") so the backdrop follows Color Harmony automatically,
   * or literal hex colours.
   */
  colors: { primary: ColorRef; secondary: ColorRef; tertiary?: ColorRef };
}

export interface TemplateParams {
  gutter: number; // inches
  radius: number; // inches
  margin: number; // inches
}

export interface Surface {
  id: SurfaceId;
  templateId: string;
  templateParams: TemplateParams;
  background: SurfaceBackground;
  elements: CardElement[];
  /** Photos that did not fit the current template (restored on switch). */
  photoStash: PhotoFill[];
  /** Text content keyed by role kept across template switches. */
  textStash: Partial<Record<TextRole, string>>;
}

export type GreetingStyle = 'short' | 'warm' | 'formal' | 'humorous' | 'family-update';

export interface PhotoRecord {
  ref: string;
  name: string;
  width: number;
  height: number;
  faces?: FaceBox[];
  facesSource?: 'immich' | 'local' | 'none';
  focus?: { x: number; y: number };
  takenAt?: string | null;
  mime?: string | null;
}

export interface CardProject {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  occasionId: string;
  greetingStyle: GreetingStyle;
  familyName: string;
  year: number;
  format: CardFormat;
  theme: Theme;
  surfaces: Surface[];
  /** Photos the user picked for this card (the "tray"). */
  photos: PhotoRecord[];
  notes?: string;
  /** Set on copies received through "Share copy with another user". */
  sharedFrom?: { userId: string; displayName: string; at: string } | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  occasionId: string;
  updatedAt: string;
  createdAt: string;
  format: Pick<CardFormat, 'sizeId' | 'widthIn' | 'heightIn' | 'fold'>;
  sharedFrom?: { displayName: string; at: string };
}

/* ---------- Export ---------- */

export type ExportFormat = 'png' | 'jpeg' | 'pdf' | 'share';

export interface ExportOptions {
  format: ExportFormat;
  surfaces: SurfaceId[];
  includeBleed: boolean;
  cropMarks: boolean;
  colorProfile: 'srgb' | 'cmyk';
  iccProfile?: string | null;
  layout: 'panels' | 'spreads';
  jpegQuality: number;
  shareFormat: 'jpeg' | 'png';
  dpi: number;
}

export interface ExportFileInfo {
  name: string;
  kind: 'print' | 'share' | 'pdf' | 'zip';
  surface?: SurfaceId | 'spread-outside' | 'spread-inside' | 'all';
  widthPx?: number;
  heightPx?: number;
  widthIn?: number;
  heightIn?: number;
  dpi?: number;
  bytes: number;
  mime: string;
  proof?: string | null;
  pages?: number;
  colorSpace?: 'sRGB' | 'CMYK';
  /** Values read back from the written file (not just what was requested). */
  verified?: {
    widthPx?: number;
    heightPx?: number;
    density?: number;
    pageSizesIn?: Array<[number, number]>;
    trimBox?: boolean;
    bleedBox?: boolean;
    /** PDF only: fonts found in the file (subset prefix removed) and whether the font program is embedded. */
    fonts?: Array<{ name: string; embedded: boolean; subtype: string }>;
    /** Privacy check of the written file: no EXIF/GPS/XMP/IPTC, no PDF creation dates or producer tags. */
    metadata?: { clean: boolean; found: string[] };
  };
}

export interface ExportRecord {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  status: 'queued' | 'rendering' | 'done' | 'error';
  progress: number;
  message?: string;
  options: ExportOptions;
  files: ExportFileInfo[];
  warnings: string[];
  error?: string;
  folder: string;
  report?: RenderReport;
  durationMs?: number;
  /** PDF exports: 300 DPI rasterizations of the finished PDF (file names inside .proof/). */
  proofs?: string[];
  iccProfileName?: string;
}
