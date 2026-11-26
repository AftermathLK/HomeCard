import { contrastRatio, mixHex, resolveColor } from '../color';
import { clampCrop, orientedFill, smartCrop, straightenAngle, straightenBox } from '../crop';
import { orientationOf } from '../formats';
import { photoContentBox, photoSafeInsets } from '../geometry';
import { getOccasion, SIGNOFFS, type Occasion } from '../holidays';
import { defaultPolish } from '../adjustments';
import type {
  CardElement,
  CardFormat,
  CardProject,
  GreetingStyle,
  PhotoElement,
  PhotoFill,
  PhotoRecord,
  Surface,
  SurfaceId,
  TemplateParams,
  TextElement,
  TextRole,
  Theme,
} from '../types';
import { uid } from '../units';
import { BUILTIN_TEMPLATES, ROLE_DEFAULTS } from './builtin';
import type { CustomTemplateJson, TemplateContext, TemplateDef, TemplateElement, TemplateSurfaceKind } from './types';

/* ---------------- Registry (built-in + custom from Style Packs) ---------------- */

const customTemplates = new Map<string, TemplateDef>();

export function registerCustomTemplates(list: CustomTemplateJson[], packId: string) {
  for (const json of list) {
    const def = customTemplateToDef(json, packId);
    if (def) customTemplates.set(def.id, def);
  }
}
export function clearCustomTemplates() {
  customTemplates.clear();
}
export function allTemplates(): TemplateDef[] {
  return [...BUILTIN_TEMPLATES, ...customTemplates.values()];
}
export function getTemplate(id: string): TemplateDef {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? customTemplates.get(id) ?? BUILTIN_TEMPLATES[0];
}
export function surfaceKind(id: SurfaceId): TemplateSurfaceKind {
  return id === 'front' ? 'front' : id === 'back' ? 'back' : 'inside';
}
export function templatesFor(kind: TemplateSurfaceKind): TemplateDef[] {
  return allTemplates().filter((t) => t.kinds.includes(kind));
}

function customTemplateToDef(json: CustomTemplateJson, packId: string): TemplateDef | null {
  if (!json || typeof json.id !== 'string' || !json.layouts) return null;
  const id = json.id.includes(':') ? json.id : `${packId}:${json.id}`;
  const anyLayout = json.layouts.any ?? json.layouts.portrait ?? json.layouts.landscape ?? json.layouts.square;
  if (!anyLayout) return null;
  const photos = new Set(anyLayout.filter((e) => e.type === 'photo').map((e: any) => e.slot)).size;
  return {
    id,
    name: json.name ?? json.id,
    description: json.description ?? `Custom template from ${packId}`,
    kinds: json.kinds ?? ['front'],
    photos,
    category: json.category ?? 'framed',
    params: [],
    defaults: { gutter: 0.08, radius: 0, margin: 0.3, ...(json.defaults ?? {}) },
    source: 'custom',
    build: (c) => {
      const layout = json.layouts[c.orientation] ?? json.layouts.any ?? anyLayout;
      return layout.map((raw) => {
        const [nx, ny, nw, nh] = raw.rect;
        let x = nx * c.w, y = ny * c.h, w = nw * c.w, h = nh * c.h;
        if (raw.bleed) {
          if (nx <= 0.001) { x -= c.bleed; w += c.bleed; }
          if (ny <= 0.001) { y -= c.bleed; h += c.bleed; }
          if (nx + nw >= 0.999) w += c.bleed;
          if (ny + nh >= 0.999) h += c.bleed;
        }
        const { rect: _r, bleed: _b, ...rest } = raw as any;
        const base = { ...rest, x, y, w, h };
        if (raw.type === 'text') {
          const d = ROLE_DEFAULTS[raw.role] ?? ROLE_DEFAULTS.custom;
          const { sizeRel, ...t } = base;
          return {
            fontRole: d.fontRole, lineHeight: d.lineHeight, align: d.align, vAlign: d.vAlign, color: d.color,
            fill: 'color', transform: d.transform, shadow: false, autoFit: true,
            ...t,
            fontSize: Math.round((sizeRel ?? d.size) * c.unit * 72 * 10) / 10,
          } as TemplateElement;
        }
        if (raw.type === 'photo') {
          const { radiusIn, ...p } = base;
          return { mask: 'rect', ...p, radius: radiusIn ?? 0 } as TemplateElement;
        }
        return base as TemplateElement;
      });
    },
  };
}

/* ---------------- Context & default content ---------------- */

export function templateContext(format: CardFormat, params: TemplateParams): TemplateContext {
  return {
    w: format.widthIn,
    h: format.heightIn,
    bleed: format.bleedIn,
    safe: format.safeIn,
    orientation: orientationOf(format.widthIn, format.heightIn),
    params,
    unit: Math.min(format.widthIn, format.heightIn),
  };
}

const RETURN_ADDRESS = '{{family}}\n[123 Street Name]\n[City, State ZIP]';

/** Default copy for a role, based on the occasion, greeting style and which side of the card. */
export function defaultText(
  role: TextRole,
  kind: TemplateSurfaceKind,
  occasion: Occasion,
  style: GreetingStyle,
  variant = 0,
  /** Second message on the same card (inside-left of a folded card): never repeat the main one. */
  alternate = false,
): string {
  const list = occasion.greetings[style]?.length ? occasion.greetings[style] : occasion.greetings.warm;
  const gr = list[variant % list.length];
  if (alternate && role === 'message') {
    const main = gr.message ?? '';
    const styles: GreetingStyle[] = [style, 'warm', 'short', 'formal', 'humorous', 'family-update'];
    for (const st of styles) {
      const l = occasion.greetings[st] ?? [];
      for (let k = 1; k <= l.length; k++) {
        const m = l[(variant + k) % l.length]?.message;
        if (m && m !== main) return m;
      }
    }
    return main;
  }
  const signoff = SIGNOFFS[style];
  if (kind === 'front') {
    switch (role) {
      case 'headline': return gr.headline;
      case 'subhead': return gr.subhead ?? '';
      case 'names': return style === 'formal' ? '{{family}}' : signoff.replace(/^With love, /, '');
      case 'year': return '{{year}}';
      case 'message': return gr.message ?? '';
      case 'body': return occasion.letterIntro;
      case 'small': return RETURN_ADDRESS;
      case 'monogram': return '{{initial}}';
      default: return '';
    }
  }
  // back / inside
  switch (role) {
    case 'headline':
      return style === 'family-update' ? (kind === 'back' ? 'Our Year in Review' : gr.headline) : kind === 'inside' ? gr.headline : (gr.subhead ?? occasion.name);
    case 'subhead': return gr.subhead ?? '';
    case 'names': return signoff;
    case 'year': return '{{year}}';
    case 'message': return gr.message ?? `Wishing you a wonderful ${occasion.name.replace(/’s$/, '')} season.`;
    case 'body': return occasion.letterIntro;
    case 'small': return RETURN_ADDRESS;
    case 'monogram': return '{{initial}}';
    default: return '';
  }
}

/* ---------------- Photo placement ---------------- */

export function fillFromRecord(rec: PhotoRecord): PhotoFill {
  return {
    ref: rec.ref,
    width: rec.width,
    height: rec.height,
    faces: rec.faces,
    focus: rec.focus,
    crop: { cx: 0.5, cy: 0.5, zoom: 1, mode: 'auto' },
    polish: defaultPolish(),
  };
}

/** (Re)compute crop for a fill placed in an element — smart crop for auto, clamp for manual. */
export function fitFill(el: Pick<PhotoElement, 'x' | 'y' | 'w' | 'h' | 'frameStyle' | 'rotation' | 'focusArea'> & Partial<PhotoElement>, fill: PhotoFill, format: CardFormat): PhotoFill {
  const box = photoContentBox(el as PhotoElement);
  const o = orientedFill(fill);
  if (fill.crop.mode === 'manual') {
    return { ...fill, crop: clampCrop(box.w, box.h, o.width, o.height, fill.crop) };
  }
  // A straightened photo is framed against the box it must cover (insets don't apply when tilted).
  const angle = straightenAngle(fill.crop.angle);
  const sb = straightenBox(box.w, box.h, angle);
  const r = smartCrop({
    frameW: sb.w,
    frameH: sb.h,
    imgW: o.width,
    imgH: o.height,
    faces: o.faces,
    focus: o.focus,
    focusArea: angle ? null : (el.focusArea ?? null),
    insets: angle ? undefined : photoSafeInsets({ ...(el as PhotoElement), type: 'photo' } as PhotoElement, format),
    minDpi: 280,
  });
  return { ...fill, crop: { cx: r.cx, cy: r.cy, zoom: r.zoom, mode: 'auto', ...(angle ? { angle } : {}) } };
}

/* ---------------- Apply / switch ---------------- */

function textKey(el: TextElement, index: number) {
  return index === 0 ? el.role : `${el.role}#${index}`;
}

export interface ApplyOptions {
  params?: Partial<TemplateParams>;
  /** Reset text to occasion defaults instead of migrating existing copy. */
  resetText?: boolean;
  greetingVariant?: number;
}

/**
 * Apply a template to a surface, migrating photos (by slot order, overflow kept in a stash),
 * text (by role) and user-added free elements so switching templates never loses work.
 */
export function applyTemplate(project: CardProject, surfaceId: SurfaceId, templateId: string, opts: ApplyOptions = {}): Surface {
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;
  const tpl = getTemplate(templateId);
  const occasion = getOccasion(project.occasionId);
  const kind = surfaceKind(surfaceId);
  const sameTemplate = surface.templateId === tpl.id;
  const params: TemplateParams = { ...tpl.defaults, ...(sameTemplate ? surface.templateParams : {}), ...(opts.params ?? {}) };
  const ctx = templateContext(project.format, params);
  const built = tpl.build(ctx);

  // Gather existing content.
  const oldPhotos = surface.elements
    .filter((e): e is PhotoElement => e.type === 'photo' && !!e.managed)
    .sort((a, b) => a.slot - b.slot);
  const fills: PhotoFill[] = [...oldPhotos.map((p) => p.fill).filter((f): f is PhotoFill => !!f), ...surface.photoStash];
  const roleCount: Record<string, number> = {};
  const oldTexts = new Map<string, string>();
  for (const el of surface.elements) {
    if (el.type !== 'text' || !el.managed) continue;
    const i = roleCount[el.role] ?? 0;
    roleCount[el.role] = i + 1;
    oldTexts.set(textKey(el, i), el.text);
  }
  const stash: Record<string, string> = { ...(surface.textStash as Record<string, string>) };
  // Words the old layout came with (a pack layout's fixed `text`) are not the person's own copy,
  // so they don't follow to the next layout and aren't stashed.
  const oldWords = new Map<string, string>();
  if (!sameTemplate) {
    const old = getTemplate(surface.templateId);
    if (old.source === 'custom') {
      const count: Record<string, number> = {};
      for (const b of old.build(templateContext(project.format, { ...old.defaults, ...surface.templateParams }))) {
        if (b.type !== 'text') continue;
        const i = count[b.role] ?? 0;
        count[b.role] = i + 1;
        if (typeof b.text === 'string') oldWords.set(i === 0 ? b.role : `${b.role}#${i}`, b.text);
      }
    }
  }
  const ownCopy = (key: string, text: string) => oldWords.get(key) !== text;
  /** Slots where the new layout's own words replaced the card's copy (which is stashed instead). */
  const layoutWordsWon = new Set<string>();

  const elements: CardElement[] = [];
  const usedKeys = new Set<string>();
  const newRoleCount: Record<string, number> = {};
  let fillIndex = 0;
  const maxSlot = Math.max(-1, ...built.filter((b) => b.type === 'photo').map((b: any) => b.slot as number));

  for (const t of built) {
    const base = { id: uid('el'), rotation: t.rotation ?? 0, opacity: t.opacity ?? 1, managed: true };
    if (t.type === 'photo') {
      const el: PhotoElement = {
        ...base,
        type: 'photo',
        x: t.x, y: t.y, w: t.w, h: t.h,
        slot: t.slot,
        fill: null,
        mask: t.mask ?? 'rect',
        radius: t.radius ?? 0,
        border: t.border ?? null,
        frameStyle: t.frameStyle ?? 'none',
        shadow: t.shadow ?? false,
        focusArea: t.focusArea,
      };
      const f = fills[t.slot] ?? null;
      if (f) {
        el.fill = fitFill(el, f, project.format);
        fillIndex = Math.max(fillIndex, t.slot + 1);
      }
      elements.push(el);
    } else if (t.type === 'text') {
      const i = newRoleCount[t.role] ?? 0;
      newRoleCount[t.role] = i + 1;
      const key = i === 0 ? t.role : `${t.role}#${i}`;
      usedKeys.add(key);
      // Re-applying the same layout (new size, orientation or settings) keeps every edit. Picking a
      // different layout brings its own words if it has them; otherwise the card's copy carries over.
      let migrated: string | undefined;
      if (!opts.resetText) {
        const prior = oldTexts.get(key);
        if (sameTemplate) migrated = prior ?? stash[key];
        else if (t.text === undefined) migrated = (prior !== undefined && ownCopy(key, prior) ? prior : undefined) ?? stash[key];
        else layoutWordsWon.add(key);
      }
      const content = migrated ?? t.text ?? defaultText(t.role, kind, occasion, project.greetingStyle, opts.greetingVariant ?? 0, surface.id === 'inside-left');
      const { type: _t, role, text: _x, ...rest } = t;
      elements.push({
        ...base,
        type: 'text',
        role,
        text: content,
        fontRole: 'body',
        fontSize: 14,
        lineHeight: 1.3,
        align: 'center',
        vAlign: 'middle',
        color: '@text',
        fill: 'color',
        shadow: false,
        autoFit: true,
        ...rest,
        x: t.x, y: t.y, w: t.w, h: t.h,
      } as TextElement);
    } else if (t.type === 'ornament') {
      const asset = t.asset === '@icon' ? `builtin:${occasion.icon}` : t.asset.includes(':') ? t.asset : `builtin:${t.asset}`;
      elements.push({ ...base, type: 'ornament', x: t.x, y: t.y, w: t.w, h: t.h, asset, color: t.color ?? '@accent', color2: t.color2, flipX: t.flipX });
    } else if (t.type === 'shape') {
      elements.push({ ...base, type: 'shape', x: t.x, y: t.y, w: t.w, h: t.h, shape: t.shape ?? 'rect', fill: t.fill === undefined ? '@accent' : t.fill, stroke: t.stroke ?? null, radius: t.radius ?? 0 });
    } else if (t.type === 'scrim') {
      elements.push({ ...base, type: 'scrim', x: t.x, y: t.y, w: t.w, h: t.h, direction: t.direction ?? 'to-top', color: t.color ?? '@scrim', strength: t.strength ?? 0.5, extent: t.extent ?? 0.3 });
    }
  }

  settleAccentInk(elements, surface, project.theme);

  // Text that the new template has no slot for is stashed (restored if you switch back).
  const newStash: Record<string, string> = {};
  const keep = (k: string) => !usedKeys.has(k) || layoutWordsWon.has(k);
  for (const [k, v] of Object.entries(stash)) if (keep(k)) newStash[k] = v;
  for (const [k, v] of oldTexts) if (keep(k) && v.trim() && ownCopy(k, v)) newStash[k] = v;

  // Free (user-added) elements stay on top.
  const free = surface.elements.filter((e) => !e.managed);

  return {
    ...surface,
    templateId: tpl.id,
    templateParams: params,
    elements: [...elements, ...free],
    photoStash: fills.slice(Math.max(fillIndex, maxSlot + 1)),
    textStash: newStash as Surface['textStash'],
  };
}

/* ---------------- Readable accent ink ---------------- */

const ACCENT_INKS = new Set(['@accent', '@accent2']);
const INK_FALLBACKS = ['@textMuted', '@text', '@background'];

function overlapArea(a: CardElement, b: CardElement) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The darkest and lightest a photo, texture or pattern beneath a see-through panel could be. */
const UNKNOWN_BENEATH = ['#000000', '#ffffff'];

/**
 * The colours text element `i` may sit on: the topmost solid panel covering it, else the card's
 * own colour. A see-through panel is blended over what is beneath it, judged at both extremes
 * when that is a photo, texture or pattern. Null when text sits straight on a photo, a shade, a
 * texture or a pattern (those are measured by the Print Guardian, not guessed here).
 */
function backingColors(elements: CardElement[], i: number, surface: Surface, theme: Theme, below = i): string[] | null {
  const t = elements[i];
  const ta = t.w * t.h;
  for (let j = below - 1; j >= 0; j--) {
    const e = elements[j];
    if (e.hidden) continue;
    const o = overlapArea(e, t);
    if ((e.type === 'photo' || e.type === 'scrim') && o > ta * 0.08) return null;
    if (e.type === 'shape' && e.shape !== 'line' && e.fill && !e.rotation && e.opacity >= 0.85 && o >= ta * 0.85) {
      const fill = resolveColor(e.fill, theme);
      if (e.opacity >= 1) return [fill];
      const under = backingColors(elements, i, surface, theme, j) ?? UNKNOWN_BENEATH;
      return under.map((u) => mixHex(u, fill, e.opacity));
    }
  }
  if (surface.background.texture || surface.background.backdrop) return null;
  return [resolveColor(surface.background.color, theme)];
}

/**
 * Subheads, years and monograms default to the theme accent, and some palettes pair a light
 * accent with light paper. Where the accent would fail the Print Guardian's contrast bar against
 * a flat backing, use the theme's soft text colour (or main text colour) instead, so a fresh
 * template never starts with a readability warning. Foil and text straight on photos are left alone.
 */
function settleAccentInk(elements: CardElement[], surface: Surface, theme: Theme) {
  elements.forEach((el, i) => {
    if (el.type !== 'text' || el.fill === 'foil' || !ACCENT_INKS.has(el.color)) return;
    const backs = backingColors(elements, i, surface, theme);
    if (!backs) return;
    const large = el.fontSize >= 18 || ((el.fontWeight ?? 400) >= 700 && el.fontSize >= 14);
    const need = large ? 3 : 4.5;
    const reads = (c: string) => backs.every((b) => contrastRatio(resolveColor(c, theme), b) >= need);
    if (reads(el.color)) return;
    const pick = INK_FALLBACKS.find(reads);
    if (pick) el.color = pick;
  });
}

/** Put a picked photo into a specific photo element (smart-cropped). */
export function placePhoto(project: CardProject, surfaceId: SurfaceId, elementId: string, rec: PhotoRecord): CardProject {
  return {
    ...project,
    surfaces: project.surfaces.map((s) =>
      s.id !== surfaceId
        ? s
        : {
            ...s,
            elements: s.elements.map((e) => {
              if (e.id !== elementId || e.type !== 'photo') return e;
              const prev = e.fill;
              const fill = fitFill(e, { ...fillFromRecord(rec), polish: prev?.polish ?? defaultPolish() }, project.format);
              return { ...e, fill };
            }),
          },
    ),
  };
}

/** Fill empty photo slots across the card with tray photos not already used. */
export function autoFillPhotos(project: CardProject, records: PhotoRecord[] = project.photos): CardProject {
  const used = new Set<string>();
  for (const s of project.surfaces) for (const e of s.elements) if (e.type === 'photo' && e.fill) used.add(e.fill.ref);
  const queue = records.filter((r) => !used.has(r.ref));
  if (!queue.length) return project;
  const order: SurfaceId[] = ['front', 'back', 'inside-right', 'inside-left'];
  const surfaces = project.surfaces.map((s) => ({ ...s, elements: [...s.elements] }));
  for (const sid of order) {
    const s = surfaces.find((x) => x.id === sid);
    if (!s) continue;
    const slots = s.elements
      .map((e, i) => ({ e, i }))
      .filter((x): x is { e: PhotoElement; i: number } => x.e.type === 'photo' && !x.e.fill)
      .sort((a, b) => a.e.slot - b.e.slot);
    for (const { e, i } of slots) {
      const rec = queue.shift();
      if (!rec) break;
      s.elements[i] = { ...e, fill: fitFill(e, fillFromRecord(rec), project.format) };
    }
  }
  return { ...project, surfaces };
}

/** Recompute auto crops for all photos (after a format change). */
export function refitAllPhotos(project: CardProject): CardProject {
  return {
    ...project,
    surfaces: project.surfaces.map((s) => ({
      ...s,
      elements: s.elements.map((e) => (e.type === 'photo' && e.fill ? { ...e, fill: fitFill(e, e.fill, project.format) } : e)),
    })),
  };
}
