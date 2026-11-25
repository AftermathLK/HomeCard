/**
 * The single card renderer. The editor shows it scaled with a CSS transform; the headless
 * print renderer (/render.html) shows it at device scale = DPI/96. Everything is laid out in
 * physical units (in / pt), so editor and print are geometrically identical.
 *
 * PDF-fidelity rules (verified against Chromium's PDF backend):
 *   - Never put CSS `filter` on content: Chromium rasterizes filtered subtrees at low resolution.
 *     Shadows are separate layers (box-shadow / text-shadow / blurred silhouettes) behind content.
 *   - background-clip:text (foils), clip-path, gradients, opacity and blend modes stay vector.
 *   - Photos are <img> elements sized to their exact print pixels; the PDF embeds them untouched.
 */
import { createContext, memo, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  backdropSvg,
  BUILTIN_FOILS,
  effectiveAdjustments,
  fontStack,
  getBuiltinOrnament,
  imageBox,
  maskPath,
  orientedFill,
  parsePackAssetRef,
  photoContentBox,
  pixelAdjustments,
  placeImage,
  resolveColor,
  resolveTokens,
  straightenAngle,
  withAlpha,
  type CardElement,
  type CardFormat,
  type CardProject,
  type FontSpec,
  type OrnamentElement,
  type PhotoElement,
  type ResolvedStylePack,
  type ScrimElement,
  type ShapeElement,
  type StickerElement,
  type Surface,
  type SurfaceBackground as SurfaceBackgroundSpec,
  type TextElement,
  type Theme,
} from '@homecard/shared';
import { cachedPackSvg, findPackBackground, findPackOrnament, loadPackSvg, packSvgUrl, textureUrl, useAssets } from '@/lib/assets';
import { previewUrl, printUrl, useEditorPhotoSrc } from '@/lib/image';

export type RenderMode = 'editor' | 'print' | 'preview';

export interface TextMeasure {
  overflow: boolean;
  /** Axis-aligned ink box of the laid-out text in card coordinates (inches from the trim corner). */
  ink: { x: number; y: number; w: number; h: number } | null;
  fittedPt: number;
}

export interface RenderEnv {
  mode: RenderMode;
  /** Output DPI (print/preview) — decides the exact pixel width requested for each photo. */
  dpi: number;
  /** Photo elements currently showing the unpolished original (hold-to-compare). */
  compareIds?: ReadonlySet<string>;
  /** Elements not drawn (e.g. the text being edited inline). */
  hiddenIds?: ReadonlySet<string>;
  /** Draw "drop photo here" placeholders for empty slots. */
  showEmptySlots?: boolean;
  /** Receives text layout measurements (Print Guardian). */
  onTextMeasure?: (id: string, m: TextMeasure) => void;
}

export const RenderEnvContext = createContext<RenderEnv>({ mode: 'editor', dpi: 96, showEmptySlots: true });

export const IN = (v: number) => `${Math.round(v * 100000) / 100000}in`;

/* ------------------------------------------------------------------ */

export interface CardSurfaceProps {
  project: CardProject;
  surface: Surface;
  packs: ResolvedStylePack[];
}

export const CardSurface = memo(function CardSurface({ project, surface, packs }: CardSurfaceProps) {
  const env = useContext(RenderEnvContext);
  const f = project.format;
  return (
    <div
      className="hc-surface"
      data-surface={surface.id}
      style={{ position: 'relative', width: IN(f.widthIn), height: IN(f.heightIn), overflow: 'visible', isolation: 'isolate' }}
    >
      <SurfaceBackground project={project} surface={surface} packs={packs} />
      {surface.elements.map((el) =>
        el.hidden || env.hiddenIds?.has(el.id) ? null : <ElementView key={el.id} el={el} project={project} packs={packs} />,
      )}
    </div>
  );
});

/** Pixels per inch the editor asks for when previewing a softened background. */
const SOFT_PREVIEW_DPI = 150;

export function textureLayout(bg: SurfaceBackgroundSpec, packs: ResolvedStylePack[]) {
  const meta = bg.texture?.startsWith('pack:') ? findPackBackground(packs, bg.texture) : undefined;
  const mode = bg.textureMode ?? meta?.mode ?? (bg.texture?.startsWith('stock:') ? 'cover' : 'tile');
  const size = bg.textureScaleIn ?? meta?.tileSizeIn ?? 2;
  return { mode, size };
}

/**
 * The URL a surface's background image is drawn from. Softened raster backgrounds come from the
 * server already enlarged to the exact pixel width they print at (plus a gentle blur), so the
 * print renderer never upsamples a small image itself. Shared with render-main's preloader.
 */
export function backgroundImageUrl(bg: SurfaceBackgroundSpec, f: Pick<CardFormat, 'widthIn' | 'heightIn' | 'bleedIn'>, packs: ResolvedStylePack[], env: Pick<RenderEnv, 'mode' | 'dpi'>): string | null {
  const ref = bg.texture;
  if (!ref) return null;
  if (bg.soften && /\.(png|jpe?g|webp)$/i.test(ref) && (ref.startsWith('stock:') || ref.startsWith('pack:'))) {
    const { mode, size } = textureLayout(bg, packs);
    const dpi = env.mode === 'editor' ? SOFT_PREVIEW_DPI : env.dpi;
    let wIn = size;
    if (mode === 'cover') {
      const W = f.widthIn + 2 * f.bleedIn;
      const H = f.heightIn + 2 * f.bleedIn;
      wIn = bg.textureWidth && bg.textureHeight ? Math.max(W, (H * bg.textureWidth) / bg.textureHeight) : W;
    }
    const w = Math.min(8000, Math.max(200, Math.ceil((wIn * dpi) / 50) * 50));
    return `/api/backgrounds/soft?ref=${encodeURIComponent(ref)}&w=${w}`;
  }
  return textureUrl(ref);
}

function SurfaceBackground({ project, surface, packs }: CardSurfaceProps) {
  const env = useContext(RenderEnvContext);
  const f = project.format;
  const b = f.bleedIn;
  const bg = surface.background;
  const color = resolveColor(bg.color, project.theme, '#ffffff');
  const { mode, size } = textureLayout(bg, packs);
  const url = backgroundImageUrl(bg, f, packs, env);
  // Unique per mounted surface so gradient ids never collide when several cards share a page.
  const prefix = `hcbd${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const backdrop = useMemo(
    () => (bg.backdrop ? backdropSvg(bg.backdrop, project.theme, { widthIn: f.widthIn, heightIn: f.heightIn, bleedIn: b }, prefix) : ''),
    [bg.backdrop, project.theme, f.widthIn, f.heightIn, b, prefix],
  );
  return (
    <div
      data-hc="background"
      style={{ position: 'absolute', left: IN(-b), top: IN(-b), width: IN(f.widthIn + 2 * b), height: IN(f.heightIn + 2 * b), background: color, overflow: 'hidden' }}
    >
      {url && (
        <div
          data-hc-bg-src={bg.texture ?? undefined}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${url}")`,
            backgroundRepeat: mode === 'cover' ? 'no-repeat' : 'repeat',
            backgroundSize: mode === 'cover' ? 'cover' : `${IN(size)} ${IN(size)}`,
            // Tiles are anchored to the trim corner so they line up identically on every export.
            backgroundPosition: mode === 'cover' ? 'center' : `${IN(b)} ${IN(b)}`,
            opacity: bg.textureOpacity ?? 1,
          }}
        />
      )}
      {/* Generated vector markup from a validated spec (see sanitizeBackdrop / backdropSvg). */}
      {backdrop && <div data-hc="backdrop" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: backdrop }} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function baseStyle(el: CardElement): CSSProperties {
  return {
    position: 'absolute',
    left: IN(el.x),
    top: IN(el.y),
    width: IN(el.w),
    height: IN(el.h),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: 'center',
    opacity: el.opacity ?? 1,
  };
}

const ElementView = memo(function ElementView({ el, project, packs }: { el: CardElement; project: CardProject; packs: ResolvedStylePack[] }) {
  switch (el.type) {
    case 'photo':
      return <PhotoView el={el} project={project} />;
    case 'text':
      return <TextView el={el} project={project} packs={packs} />;
    case 'ornament':
      return <OrnamentView el={el} theme={project.theme} packs={packs} />;
    case 'sticker':
      return <StickerView el={el} />;
    case 'shape':
      return <ShapeView el={el} theme={project.theme} />;
    case 'scrim':
      return <ScrimView el={el} theme={project.theme} />;
    default:
      return null;
  }
});

/* ---------------------------- Photo ---------------------------- */

function maskCss(el: PhotoElement, wIn: number, hIn: number): { style: CSSProperties; path: { d: string; evenodd?: boolean } | null } {
  switch (el.mask) {
    case 'rounded':
      return { style: { borderRadius: IN(Math.min(el.radius || 0.15, Math.min(wIn, hIn) / 2)) }, path: null };
    case 'circle':
    case 'ellipse':
      return { style: { borderRadius: '50%' }, path: null };
    case 'rect':
      return { style: el.radius ? { borderRadius: IN(Math.min(el.radius, Math.min(wIn, hIn) / 2)) } : {}, path: null };
    default: {
      const p = maskPath(el.mask, wIn * 96, hIn * 96);
      return { style: p ? { clipPath: `path(${p.evenodd ? 'evenodd, ' : ''}'${p.d}')` } : {}, path: p };
    }
  }
}

const SHADOW = '0 0.02in 0.05in rgba(0,0,0,0.18), 0 0.07in 0.2in rgba(0,0,0,0.2)';

function PhotoView({ el, project }: { el: PhotoElement; project: CardProject }) {
  const env = useContext(RenderEnvContext);
  const theme = project.theme;
  const box = photoContentBox(el);
  const fill = el.fill;
  const oriented = fill ? orientedFill(fill) : null;
  const place = fill && oriented ? placeImage(box.w, box.h, oriented.width, oriented.height, fill.crop) : null;
  // The <img> keeps the photo's own axes; a CSS turn/mirror lays it over `place`.
  const ib = fill && place ? imageBox(place, fill) : null;
  const angle = fill ? straightenAngle(fill.crop.angle) : 0;
  const compare = !!env.compareIds?.has(el.id);
  const editorSrc = useEditorPhotoSrc(env.mode === 'editor' ? fill : null, compare);
  const eff = fill ? effectiveAdjustments(fill.polish) : null;

  let src: string | null = null;
  let requestPx = 0;
  if (fill && place) {
    if (env.mode === 'editor') src = editorSrc;
    else {
      const adj = pixelAdjustments(eff!);
      requestPx = Math.ceil(ib!.width * env.dpi);
      if (env.mode === 'print') src = printUrl(fill.ref, requestPx, adj);
      else src = Object.keys(adj).length ? printUrl(fill.ref, Math.min(1400, Math.max(400, requestPx)), adj) : previewUrl(fill.ref);
    }
  }

  const mask = maskCss(el, box.w, box.h);
  const framed = el.frameStyle !== 'none';
  const outer: CSSProperties = baseStyle(el);
  if (el.frameStyle === 'polaroid') outer.background = '#fbfaf6';
  if (el.frameStyle === 'mat') outer.background = resolveColor('@surface', theme, '#ffffff');
  const contentPos: CSSProperties = { position: 'absolute', left: IN(box.x), top: IN(box.y), width: IN(box.w), height: IN(box.h) };
  const showCompare = compare && env.mode === 'editor';
  const vignette = eff && !showCompare ? eff.vignette : 0;
  const grain = eff && !showCompare ? eff.grain : 0;
  const borderColor = el.border ? resolveColor(el.border.color, theme, '#ffffff') : null;

  return (
    <div data-el={el.id} data-type="photo" style={outer}>
      {/* Shadow layer (never a filter on the photo itself). */}
      {el.shadow && framed && <div style={{ position: 'absolute', inset: 0, boxShadow: SHADOW }} />}
      {el.shadow && !framed && !mask.path && <div style={{ ...contentPos, ...mask.style, boxShadow: SHADOW }} />}
      {el.shadow && !framed && mask.path && (
        <div style={{ ...contentPos, transform: 'translateY(0.05in)', filter: 'blur(0.06in)', opacity: 0.45 }}>
          <div style={{ position: 'absolute', inset: 0, background: '#000', clipPath: mask.style.clipPath }} />
        </div>
      )}
      {framed && el.frameStyle === 'mat' && (
        <div style={{ position: 'absolute', inset: 0, border: `${IN(0.006)} solid rgba(0,0,0,0.12)` }} />
      )}
      <div style={{ ...contentPos, overflow: 'hidden', ...mask.style, background: fill ? undefined : 'transparent' }}>
        {fill && ib && src ? (
          <Straighten angle={angle}>
          <img
            src={src}
            alt=""
            draggable={false}
            data-hc-photo={el.id}
            data-ref={fill.ref}
            data-req={requestPx || undefined}
            data-win={ib.width}
            decoding={env.mode === 'editor' ? 'async' : 'sync'}
            style={{
              position: 'absolute',
              left: IN(ib.left),
              top: IN(ib.top),
              width: IN(ib.width),
              height: IN(ib.height),
              transform: ib.transform,
              maxWidth: 'none',
              maxHeight: 'none',
              display: 'block',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
          </Straighten>
        ) : env.mode === 'editor' && env.showEmptySlots !== false ? (
          <EmptySlot n={el.slot} />
        ) : null}
        {vignette > 0.001 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,${(vignette * 0.75).toFixed(3)}) 100%)`,
              pointerEvents: 'none',
            }}
          />
        )}
        {grain > 0.001 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'url("/textures/grain.png")',
              backgroundSize: '1in 1in',
              mixBlendMode: 'overlay',
              opacity: Math.min(1, grain * 0.9),
              pointerEvents: 'none',
            }}
          />
        )}
        {el.border && el.border.width > 0 && !mask.path && (
          <div style={{ position: 'absolute', inset: 0, border: `${IN(el.border.width)} solid ${borderColor}`, borderRadius: mask.style.borderRadius, pointerEvents: 'none' }} />
        )}
        {el.border && el.border.width > 0 && mask.path && (
          <svg width="100%" height="100%" viewBox={`0 0 ${box.w * 96} ${box.h * 96}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            <path d={mask.path.d} fill="none" stroke={borderColor!} strokeWidth={el.border.width * 96 * 2} fillRule={mask.path.evenodd ? 'evenodd' : 'nonzero'} />
          </svg>
        )}
      </div>
    </div>
  );
}

/** Turns its photo about the frame centre (the straighten angle); renders children as-is when 0. */
function Straighten({ angle, children }: { angle: number; children: ReactNode }) {
  if (!angle) return <>{children}</>;
  return <div style={{ position: 'absolute', inset: 0, transform: `rotate(${angle}deg)` }}>{children}</div>;
}

function EmptySlot({ n }: { n: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'repeating-linear-gradient(45deg, rgba(120,110,100,0.10) 0 0.08in, rgba(120,110,100,0.04) 0.08in 0.16in)',
        border: '0.02in dashed rgba(90,80,70,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(60,52,44,0.7)',
        font: '600 11pt system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <span>
        Photo {n + 1}
        <br />
        <span style={{ fontWeight: 400, fontSize: '8pt' }}>drop or click to add</span>
      </span>
    </div>
  );
}

/* ---------------------------- Text ---------------------------- */

export function textFont(el: TextElement, theme: Theme): FontSpec & { size: number } {
  const base = theme.fonts[el.fontRole] ?? theme.fonts.body;
  const transform = el.transform && el.transform !== 'theme' ? el.transform : (base.transform ?? 'none');
  return {
    family: el.fontFamily || base.family,
    weight: el.fontWeight ?? base.weight,
    style: el.italic === undefined ? base.style : el.italic ? 'italic' : 'normal',
    letterSpacing: el.letterSpacing ?? base.letterSpacing ?? 0,
    transform,
    size: el.fontSize,
  };
}

export function foilFor(id: string, packs: ResolvedStylePack[]) {
  if (id.startsWith('pack:')) {
    for (const p of packs) {
      const f = p.foils.find((x) => x.id === id);
      if (f) return f;
    }
  }
  return BUILTIN_FOILS.find((f) => f.id === id) ?? BUILTIN_FOILS[0];
}

function TextView({ el, project, packs }: { el: TextElement; project: CardProject; packs: ResolvedStylePack[] }) {
  const env = useContext(RenderEnvContext);
  const fontTick = useAssets((s) => s.fontLoadTick);
  const theme = project.theme;
  const font = textFont(el, theme);
  const text = resolveTokens(el.text, project);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(font.size);
  const color = resolveColor(el.color, theme, '#000000');
  const foil = el.fill === 'foil' ? foilFor(theme.foil || 'gold', packs) : null;

  // Shrink-to-fit (never grows) — identical algorithm in editor and print, run after fonts load.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const fits = (pt: number) => {
      inner.style.fontSize = `${pt}pt`;
      return inner.scrollHeight <= outer.clientHeight + 0.5 && inner.scrollWidth <= outer.clientWidth + 0.5;
    };
    let size = font.size;
    if (el.autoFit && !fits(size)) {
      let lo = Math.max(4, font.size * 0.3);
      let hi = font.size;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      size = Math.floor(lo * 10) / 10;
    }
    inner.style.fontSize = `${size}pt`;
    if (size !== fitted) setFitted(size);
    if (env.onTextMeasure) {
      const overflow = inner.scrollHeight > outer.clientHeight + 1 || inner.scrollWidth > outer.clientWidth + 1;
      const surf = outer.closest('.hc-surface') as HTMLElement | null;
      let ink: TextMeasure['ink'] = null;
      if (surf && text.trim()) {
        const range = document.createRange();
        range.selectNodeContents(inner);
        const r = range.getBoundingClientRect();
        const sr = surf.getBoundingClientRect();
        const k = sr.width > 0 ? surf.offsetWidth / sr.width / 96 : 1 / 96; // screen px -> inches (undo editor zoom)
        if (r.width > 0) ink = { x: (r.left - sr.left) * k, y: (r.top - sr.top) * k, w: r.width * k, h: r.height * k };
      }
      env.onTextMeasure(el.id, { overflow, ink, fittedPt: size });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, font.size, font.family, font.weight, font.style, font.letterSpacing, font.transform, el.x, el.y, el.w, el.h, el.rotation, el.lineHeight, el.autoFit, fontTick]);

  const justify = el.vAlign === 'top' ? 'flex-start' : el.vAlign === 'bottom' ? 'flex-end' : 'center';
  const typo: CSSProperties = {
    fontFamily: fontStack(font.family),
    fontWeight: font.weight,
    fontStyle: font.style,
    fontSize: `${fitted}pt`,
    lineHeight: el.lineHeight,
    letterSpacing: font.letterSpacing ? `${font.letterSpacing}em` : undefined,
    textTransform: font.transform === 'uppercase' ? 'uppercase' : 'none',
    textAlign: el.align,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    fontKerning: 'normal',
    fontVariantLigatures: 'common-ligatures contextual',
    margin: 0,
    width: '100%',
  };
  const shadow = el.shadow ? `0 0.012in 0.04in ${withAlpha('#000000', 0.45)}, 0 0 0.12in ${withAlpha('#000000', 0.25)}` : undefined;

  const fillStyle: CSSProperties = foil
    ? {
        backgroundImage: foil.texture ? `url("${foil.texture}")` : foil.gradient,
        backgroundSize: foil.texture ? 'cover' : '100% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
      }
    : { color, textShadow: shadow };

  return (
    <div
      ref={outerRef}
      data-el={el.id}
      data-type="text"
      style={{ ...baseStyle(el), display: 'flex', flexDirection: 'column', justifyContent: justify, overflow: 'visible' }}
    >
      {foil && shadow && (
        // Foil + shadow: the shadow is drawn by a transparent copy underneath (keeps foil glyphs vector).
        <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: justify }}>
          <div style={{ ...typo, color: 'transparent', textShadow: shadow }}>{text}</div>
        </div>
      )}
      <div ref={innerRef} style={{ ...typo, ...fillStyle, position: 'relative' }}>
        {text || (env.mode === 'editor' ? ' ' : '')}
      </div>
    </div>
  );
}

/* ---------------------------- Ornaments & stickers ---------------------------- */

function OrnamentView({ el, theme, packs }: { el: OrnamentElement; theme: Theme; packs: ResolvedStylePack[] }) {
  const color = resolveColor(el.color, theme, '#000000');
  const color2 = el.color2 ? resolveColor(el.color2, theme, color) : color;
  const style: CSSProperties = {
    ...baseStyle(el),
    color,
    ['--hc-orn2' as any]: color2,
    transform: [el.rotation ? `rotate(${el.rotation}deg)` : '', el.flipX ? 'scaleX(-1)' : ''].filter(Boolean).join(' ') || undefined,
  };
  if (el.asset.startsWith('builtin:')) {
    const def = getBuiltinOrnament(el.asset.slice(8));
    if (!def) return null;
    return <div data-el={el.id} data-type="ornament" className="hc-svg" style={style} dangerouslySetInnerHTML={{ __html: def.svg }} />;
  }
  const meta = findPackOrnament(packs, el.asset);
  return <PackSvg el={el} style={style} recolor={meta?.recolorable ?? true} stretch={!!meta?.stretch} />;
}

function PackSvg({ el, style, recolor, stretch }: { el: OrnamentElement; style: CSSProperties; recolor: boolean; stretch: boolean }) {
  const [svg, setSvg] = useState<string | undefined>(() => cachedPackSvg(el.asset));
  useLayoutEffect(() => {
    if (svg) return;
    let alive = true;
    loadPackSvg(el.asset)
      .then((t) => alive && setSvg(t))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [el.asset, svg]);
  if (!svg) return <div data-el={el.id} data-type="ornament" data-pending={svg === undefined ? '1' : undefined} style={style} />;
  const markup = stretch ? svg.replace(/<svg\b/i, '<svg preserveAspectRatio="none"') : svg;
  return <div data-el={el.id} data-type="ornament" className={`hc-svg${recolor ? ' hc-recolor' : ''}`} style={style} dangerouslySetInnerHTML={{ __html: markup }} />;
}

function StickerView({ el }: { el: StickerElement }) {
  const url = packSvgUrl(el.asset);
  const style: CSSProperties = {
    ...baseStyle(el),
    transform: [el.rotation ? `rotate(${el.rotation}deg)` : '', el.flipX ? 'scaleX(-1)' : ''].filter(Boolean).join(' ') || undefined,
  };
  return (
    <div data-el={el.id} data-type="sticker" style={style}>
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', maxWidth: 'none', pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}

/* ---------------------------- Shapes & scrims ---------------------------- */

function ShapeView({ el, theme }: { el: ShapeElement; theme: Theme }) {
  const fill = el.fill ? resolveColor(el.fill, theme, 'transparent') : 'transparent';
  const stroke = el.stroke && el.stroke.width > 0 ? `${IN(el.stroke.width)} solid ${resolveColor(el.stroke.color, theme, '#000')}` : undefined;
  if (el.shape === 'line') {
    const t = el.stroke?.width || 0.01;
    return (
      <div data-el={el.id} data-type="shape" style={baseStyle(el)}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: IN(t), marginTop: IN(-t / 2), background: resolveColor(el.stroke?.color ?? el.fill ?? '@text', theme, '#000') }} />
      </div>
    );
  }
  return (
    <div
      data-el={el.id}
      data-type="shape"
      style={{
        ...baseStyle(el),
        background: fill,
        border: stroke,
        borderRadius: el.shape === 'ellipse' ? '50%' : el.radius ? IN(el.radius) : undefined,
      }}
    />
  );
}

function ScrimView({ el, theme }: { el: ScrimElement; theme: Theme }) {
  const c = resolveColor(el.color, theme, '#000000');
  const a = (v: number) => withAlpha(c.slice(0, 7), Math.max(0, Math.min(1, v)));
  const solid = Math.round(Math.max(0, Math.min(1, el.extent)) * 100);
  let background: string;
  if (el.direction === 'solid') background = a(el.strength);
  else if (el.direction === 'radial')
    background = `radial-gradient(closest-side, ${a(el.strength)} 0%, ${a(el.strength)} ${solid}%, ${a(0)} 100%)`;
  else background = `linear-gradient(${el.direction.replace('-', ' ')}, ${a(el.strength)} 0%, ${a(el.strength)} ${solid}%, ${a(el.strength * 0.35)} ${solid + (100 - solid) * 0.55}%, ${a(0)} 100%)`;
  return <div data-el={el.id} data-type="scrim" style={{ ...baseStyle(el), background, pointerEvents: 'none' }} />;
}

/* ---------------------------- Helpers ---------------------------- */

/** Fonts (family/weight/style) a project needs — used to preload before measuring/printing. */
export function fontsUsed(project: CardProject): Array<{ family: string; weight: number; style: string }> {
  const out = new Map<string, { family: string; weight: number; style: string }>();
  for (const s of project.surfaces)
    for (const e of s.elements) {
      if (e.type !== 'text' || e.hidden) continue;
      const f = textFont(e, project.theme);
      out.set(`${f.family}|${f.weight}|${f.style}`, { family: f.family, weight: f.weight, style: f.style });
    }
  return [...out.values()];
}
