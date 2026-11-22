import type {
  MaskShape,
  Orientation,
  OrnamentElement,
  PhotoElement,
  ScrimElement,
  ShapeElement,
  TemplateParams,
  TextElement,
  TextRole,
} from '../types';

export interface TemplateContext {
  w: number;
  h: number;
  bleed: number;
  safe: number;
  orientation: Orientation;
  params: TemplateParams;
  /** min(w, h) — base unit for relative type sizes. */
  unit: number;
}

type Geo = { x: number; y: number; w: number; h: number; rotation?: number; opacity?: number };

export type TPhoto = Geo & { type: 'photo'; slot: number } & Partial<
    Pick<PhotoElement, 'mask' | 'radius' | 'border' | 'frameStyle' | 'shadow' | 'focusArea'>
  >;
export type TText = Geo & { type: 'text'; role: TextRole } & Partial<
    Omit<TextElement, 'id' | 'type' | 'role' | 'x' | 'y' | 'w' | 'h' | 'text'>
  > & { text?: string };
export type TOrnament = Geo & { type: 'ornament'; asset: string } & Partial<Pick<OrnamentElement, 'color' | 'color2' | 'flipX'>>;
export type TShape = Geo & { type: 'shape' } & Partial<Pick<ShapeElement, 'shape' | 'fill' | 'stroke' | 'radius'>>;
export type TScrim = Geo & { type: 'scrim' } & Partial<Pick<ScrimElement, 'direction' | 'color' | 'strength' | 'extent'>>;

export type TemplateElement = TPhoto | TText | TOrnament | TShape | TScrim;

export type TemplateSurfaceKind = 'front' | 'back' | 'inside';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  kinds: TemplateSurfaceKind[];
  photos: number;
  category: 'full-bleed' | 'framed' | 'collage' | 'cutout' | 'split' | 'typography' | 'letter' | 'postcard';
  params: Array<keyof TemplateParams>;
  defaults: TemplateParams;
  tags?: string[];
  source: 'builtin' | 'custom';
  build: (ctx: TemplateContext) => TemplateElement[];
}

/** JSON schema for custom templates (Style Packs). Rects are normalized (0..1) to the trim box. */
export interface CustomTemplateJson {
  id: string;
  name: string;
  description?: string;
  kinds?: TemplateSurfaceKind[];
  category?: TemplateDef['category'];
  defaults?: Partial<TemplateParams>;
  layouts: Partial<Record<Orientation | 'any', CustomLayoutElement[]>>;
}

export type CustomLayoutElement = (
  | ({ type: 'photo'; slot: number; mask?: MaskShape; radiusIn?: number } & Partial<Pick<PhotoElement, 'frameStyle' | 'shadow' | 'focusArea'>>)
  | ({ type: 'text'; role: TextRole; sizeRel?: number } & Partial<Pick<TextElement, 'fontRole' | 'align' | 'vAlign' | 'color' | 'fill' | 'lineHeight' | 'shadow' | 'text'>>)
  | ({ type: 'ornament'; asset: string } & Partial<Pick<OrnamentElement, 'color' | 'color2' | 'flipX'>>)
  | ({ type: 'shape' } & Partial<Pick<ShapeElement, 'shape' | 'fill' | 'radius'>>)
  | ({ type: 'scrim' } & Partial<Pick<ScrimElement, 'direction' | 'color' | 'strength' | 'extent'>>)
) & {
  /** Normalized rect (0..1) relative to the trim box. */
  rect: [number, number, number, number];
  /** Extend edges touching the trim out to the bleed. */
  bleed?: boolean;
  rotation?: number;
  opacity?: number;
};
