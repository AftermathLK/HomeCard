import { sanitizeBackdrop } from './backdrops';
import { applyPairing, getPairing } from './fonts';
import { makeFormat, surfacesFor } from './formats';
import { defaultYearFor, getOccasion, PLACEHOLDER_FAMILY } from './holidays';
import { applyTemplate, getTemplate, surfaceKind, templatesFor } from './templates/apply';
import type { CardFormat, CardProject, GreetingStyle, Surface, SurfaceId, Theme } from './types';
import { uid } from './units';

export const SCHEMA_VERSION = 1;

export function themeForOccasion(occasionId: string, paletteIndex = 0): Theme {
  const occ = getOccasion(occasionId);
  const pal = occ.palettes[paletteIndex % occ.palettes.length];
  const pairing = getPairing(occ.pairing);
  return applyPairing(
    {
      paletteId: pal.id,
      paletteName: pal.name,
      colors: { ...pal.colors },
      fonts: { display: pairing.display, body: pairing.body, accent: pairing.accent },
      foil: occ.defaultFoil ?? 'gold',
    },
    pairing.id,
  );
}

export function defaultTemplateFor(surfaceId: SurfaceId, occasionId: string, style: GreetingStyle, fold: CardFormat['fold']): string {
  const occ = getOccasion(occasionId);
  if (surfaceId === 'front') return occ.frontTemplate;
  if (surfaceId === 'back') {
    if (fold === 'folded') return 'back-monogram';
    return style === 'family-update' ? 'back-letter' : 'back-collage-note';
  }
  if (surfaceId === 'inside-left') return style === 'family-update' ? 'back-collage-note' : 'inside-quote';
  return style === 'family-update' ? 'back-letter' : 'inside-message';
}

function emptySurface(id: SurfaceId, templateId: string): Surface {
  const t = getTemplate(templateId);
  return {
    id,
    templateId: t.id,
    templateParams: { ...t.defaults },
    background: { color: '@background', texture: null, textureMode: 'tile', textureScaleIn: 2, textureOpacity: 1 },
    elements: [],
    photoStash: [],
    textStash: {},
  };
}

export interface NewProjectOptions {
  name?: string;
  occasionId: string;
  greetingStyle?: GreetingStyle;
  familyName?: string;
  sizeId?: string;
  orientation?: 'portrait' | 'landscape';
  vendorId?: string;
  fold?: CardFormat['fold'];
  includeBack?: boolean;
  customW?: number;
  customH?: number;
  now?: Date;
}

export function createProject(o: NewProjectOptions): CardProject {
  const occ = getOccasion(o.occasionId);
  const now = (o.now ?? new Date()).toISOString();
  const style = o.greetingStyle ?? 'warm';
  const format = makeFormat({
    sizeId: o.sizeId ?? '5x7',
    orientation: o.orientation ?? 'portrait',
    vendorId: o.vendorId,
    fold: o.fold ?? 'flat',
    includeBack: o.includeBack ?? true,
    customW: o.customW,
    customH: o.customH,
  });
  let project: CardProject = {
    id: uid(),
    schemaVersion: SCHEMA_VERSION,
    name: o.name?.trim() || `${occ.name} ${defaultYearFor(occ, o.now)}`,
    createdAt: now,
    updatedAt: now,
    occasionId: occ.id,
    greetingStyle: style,
    familyName: o.familyName?.trim() ?? '',
    year: defaultYearFor(occ, o.now),
    format,
    theme: themeForOccasion(occ.id),
    surfaces: surfacesFor(format).map((sid) => emptySurface(sid, defaultTemplateFor(sid, occ.id, style, format.fold))),
    photos: [],
  };
  for (const s of project.surfaces) {
    project = { ...project, surfaces: project.surfaces.map((x) => (x.id === s.id ? applyTemplate(project, s.id, s.templateId) : x)) };
  }
  return project;
}

/** Change size/vendor/fold. Surfaces are added/removed and every template is re-laid-out. */
export function changeFormat(project: CardProject, format: CardFormat): CardProject {
  const wanted = surfacesFor(format);
  const existing = new Map(project.surfaces.map((s) => [s.id, s]));
  let next: CardProject = {
    ...project,
    format,
    surfaces: wanted.map((sid) => existing.get(sid) ?? emptySurface(sid, defaultTemplateFor(sid, project.occasionId, project.greetingStyle, format.fold))),
  };
  for (const s of next.surfaces) {
    const kind = surfaceKind(s.id);
    const valid = templatesFor(kind).some((t) => t.id === s.templateId) ? s.templateId : defaultTemplateFor(s.id, project.occasionId, project.greetingStyle, format.fold);
    next = { ...next, surfaces: next.surfaces.map((x) => (x.id === s.id ? applyTemplate(next, s.id, valid) : x)) };
  }
  return next;
}

/** Switch occasion: new palette, pairing and greeting copy; photos are kept. */
export function changeOccasion(project: CardProject, occasionId: string, style?: GreetingStyle): CardProject {
  const occ = getOccasion(occasionId);
  let next: CardProject = {
    ...project,
    occasionId: occ.id,
    greetingStyle: style ?? project.greetingStyle,
    year: defaultYearFor(occ),
    theme: themeForOccasion(occ.id),
  };
  for (const s of next.surfaces) {
    const tpl = s.id === 'front' ? occ.frontTemplate : s.templateId;
    next = { ...next, surfaces: next.surfaces.map((x) => (x.id === s.id ? applyTemplate(next, s.id, tpl, { resetText: true }) : x)) };
  }
  return next;
}

/** Re-generate greeting copy for all surfaces (keeps layout + photos). */
export function changeGreeting(project: CardProject, style: GreetingStyle, variant = 0): CardProject {
  let next: CardProject = { ...project, greetingStyle: style };
  for (const s of next.surfaces) {
    next = { ...next, surfaces: next.surfaces.map((x) => (x.id === s.id ? applyTemplate(next, s.id, s.templateId, { resetText: true, greetingVariant: variant }) : x)) };
  }
  return next;
}

/* ---------------- Tokens ---------------- */

export function resolveTokens(text: string, project: Pick<CardProject, 'familyName' | 'year'>): string {
  if (!text || text.indexOf('{{') < 0) return text;
  const fam = project.familyName?.trim() || PLACEHOLDER_FAMILY;
  const initial = (project.familyName?.trim().replace(/^the\s+/i, '') || 'S').charAt(0).toUpperCase();
  return text
    .replace(/\{\{\s*family\s*\}\}/gi, fam)
    .replace(/\{\{\s*year\s*\}\}/gi, String(project.year))
    .replace(/\{\{\s*nextYear\s*\}\}/gi, String(project.year + 1))
    .replace(/\{\{\s*lastYear\s*\}\}/gi, String(project.year - 1))
    .replace(/\{\{\s*initial\s*\}\}/gi, initial);
}

/** Deep clone a project as a new variation. */
export function duplicateProject(p: CardProject, name?: string): CardProject {
  const now = new Date().toISOString();
  const copy: CardProject = JSON.parse(JSON.stringify(p));
  copy.id = uid();
  copy.name = name?.trim() || `${p.name} (copy)`;
  copy.createdAt = now;
  copy.updatedAt = now;
  for (const s of copy.surfaces) for (const e of s.elements) e.id = uid('el');
  return copy;
}

export function migrateProject(raw: any): CardProject {
  const p = raw as CardProject;
  if (!p.schemaVersion) p.schemaVersion = SCHEMA_VERSION;
  if (!p.photos) p.photos = [];
  for (const s of p.surfaces ?? []) {
    s.photoStash ??= [];
    s.textStash ??= {};
    s.templateParams ??= { gutter: 0.08, radius: 0, margin: 0.3 };
    // Backdrops are turned into SVG markup: re-validate them on every load (shared copies included).
    if (s.background) s.background.backdrop = s.background.backdrop ? sanitizeBackdrop(s.background.backdrop) : null;
  }
  return p;
}
