/**
 * Print Guardian — pre-flight rules that catch bad prints before they happen.
 * Pure function: the editor supplies DOM measurements (text ink bounds, overflow, contrast samples).
 */
import { effectiveDpi, facesOnCard, orientedFill, significantFaces } from './crop';
import { SURFACE_INFO, safeRect, trimRect, type RectIn } from './formats';
import { photoContentBox } from './geometry';
import { PLACEHOLDER_FAMILY, PLACEHOLDER_PATTERNS } from './holidays';
import { resolveTokens } from './project';
import type { CardFormat, CardProject, PhotoElement, SurfaceBackground, SurfaceId, TextElement } from './types';

export type Severity = 'ok' | 'info' | 'warn' | 'error';
export type CheckId = 'resolution' | 'safe-zone' | 'faces' | 'contrast' | 'placeholder' | 'content' | 'fonts' | 'overflow';

export const DPI_GOOD = 250;
export const DPI_MIN = 180;

export interface GuardianIssue {
  id: string;
  check: CheckId;
  severity: Exclude<Severity, 'ok'>;
  surfaceId: SurfaceId;
  elementId?: string;
  title: string;
  detail: string;
  fix?: 'zoom-out' | 'replace-photo' | 'edit-text' | 'move-inside' | 'smart-crop' | 'readability' | 'fill-slot' | 'change-font' | 'fit-text' | 'soften-background';
}

export interface GuardianCheck {
  id: CheckId;
  label: string;
  description: string;
  status: Severity;
  issues: number;
}

export interface PhotoDpiInfo {
  surfaceId: SurfaceId;
  elementId: string;
  ref: string;
  dpi: number;
  severity: Severity;
  printWidthIn: number;
  printHeightIn: number;
}

export interface GuardianReport {
  status: 'green' | 'yellow' | 'red';
  checks: GuardianCheck[];
  issues: GuardianIssue[];
  photos: PhotoDpiInfo[];
}

export interface GuardianInput {
  textBounds: Record<string, RectIn | undefined>;
  textOverflow: Record<string, boolean | undefined>;
  textContrast: Record<string, number | undefined>;
  failedRefs: string[];
  availableFonts: string[];
  /** Style-pack artwork refs that exist right now ("pack:<id>/<file>"). Omit to skip the check. */
  availableAssets?: string[];
}

const CHECK_META: Record<CheckId, { label: string; description: string }> = {
  resolution: { label: 'Photo resolution', description: `Every photo prints at ${DPI_GOOD}+ DPI` },
  'safe-zone': { label: 'Safe zone', description: 'Text stays clear of the trim and bleed' },
  faces: { label: 'Faces', description: 'No faces are cut off by edges or frames' },
  contrast: { label: 'Readability', description: 'Text has enough contrast to read easily' },
  placeholder: { label: 'Placeholder text', description: 'No sample names or [bracketed] prompts left' },
  content: { label: 'Photos & artwork', description: 'All photo frames are filled, and every photo and artwork file can be loaded' },
  fonts: { label: 'Fonts', description: 'All fonts are installed for the print renderer' },
  overflow: { label: 'Text fit', description: 'All text fits inside its box' },
};

const rank: Record<Severity, number> = { ok: 0, info: 1, warn: 2, error: 3 };

function intersect(a: RectIn, b: RectIn): RectIn | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}
const area = (r: RectIn | null) => (r ? r.w * r.h : 0);
const inside = (outer: RectIn, inner: RectIn, eps = 0.005) =>
  inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;

/** WCAG "large text": 18pt+, or 14pt+ bold. Large text needs 3:1 instead of 4.5:1. */
export function isLargeText(el: TextElement) {
  return el.fontSize >= 18 || ((el.fontWeight ?? 400) >= 700 && el.fontSize >= 14);
}

export function photoDpi(el: PhotoElement): number | null {
  if (!el.fill) return null;
  const box = photoContentBox(el);
  const o = orientedFill(el.fill);
  return effectiveDpi(box.w, box.h, o.width, o.height, el.fill.crop.zoom);
}

/** Below this a raster background (stock photo or texture) gets a Print Guardian note. */
export const BACKGROUND_DPI_MIN = 200;

/**
 * Effective print resolution of a raster background image, when its pixel size is known
 * (stock backgrounds record it). Cover mode fills the whole bleed area; tile mode repeats it.
 */
export function backgroundDpi(bg: SurfaceBackground, f: Pick<CardFormat, 'widthIn' | 'heightIn' | 'bleedIn'>): number | null {
  if (!bg.texture || !bg.textureWidth || !bg.textureHeight) return null;
  if (/\.svg$/i.test(bg.texture)) return null;
  if ((bg.textureMode ?? 'cover') === 'tile') return bg.textureWidth / Math.max(0.1, bg.textureScaleIn ?? 2);
  const W = f.widthIn + 2 * f.bleedIn;
  const H = f.heightIn + 2 * f.bleedIn;
  const shownW = Math.max(W, (H * bg.textureWidth) / bg.textureHeight);
  return bg.textureWidth / shownW;
}

export function runGuardian(project: CardProject, input: GuardianInput): GuardianReport {
  const issues: GuardianIssue[] = [];
  const photos: PhotoDpiInfo[] = [];
  const f = project.format;
  const trim = trimRect(f);
  const safe = safeRect(f);
  const failed = new Set(input.failedRefs);
  const fonts = new Set(input.availableFonts.map((x) => x.toLowerCase()));
  const assets = input.availableAssets ? new Set(input.availableAssets) : null;
  const missingAsset = (ref: string | null | undefined) => !!(assets && ref && ref.startsWith('pack:') && !assets.has(ref));
  const packOf = (ref: string) => /^pack:([^/]+)\/(.+)$/.exec(ref) ?? ['', '?', ref];
  let n = 0;
  const add = (i: Omit<GuardianIssue, 'id'>) => issues.push({ ...i, id: `g${n++}` });

  for (const s of project.surfaces) {
    const label = SURFACE_INFO[s.id].label;
    if (missingAsset(s.background.texture)) {
      const [, pack, file] = packOf(s.background.texture!);
      add({ check: 'content', severity: 'error', surfaceId: s.id, title: `Missing background on the ${label}`, detail: `“${file}” from the “${pack}” style pack is no longer installed, so the background would print plain. Choose another texture, or restore the pack in /data/styles.` });
    }
    if (s.background.texture && failed.has(s.background.texture))
      add({ check: 'content', severity: 'error', surfaceId: s.id, title: `The background on the ${label} can’t be loaded`, detail: 'The background image file is missing. Pick it again in Backgrounds, or choose another one.' });
    const bgDpi = backgroundDpi(s.background, f);
    if (bgDpi !== null && bgDpi < BACKGROUND_DPI_MIN && (s.background.textureOpacity ?? 1) > 0.15) {
      if (!s.background.soften)
        add({
          check: 'resolution', severity: 'warn', surfaceId: s.id,
          title: `Low-resolution background on the ${label} (${Math.round(bgDpi)} DPI)`,
          detail: 'Fine detail in this background may look pixelated in print. Turn on “Soften” so it prints smooth, or pick a larger image.',
          fix: 'soften-background',
        });
      else
        add({
          check: 'resolution', severity: 'info', surfaceId: s.id,
          title: `Softened background on the ${label} (${Math.round(bgDpi)} DPI source)`,
          detail: 'The background is enlarged and gently blurred for print, so it prints smooth rather than sharp.',
        });
    }
    for (const el of s.elements) {
      if (el.hidden) continue;
      if ((el.type === 'ornament' || el.type === 'sticker') && missingAsset(el.asset)) {
        const [, pack, file] = packOf(el.asset);
        add({ check: 'content', severity: 'error', surfaceId: s.id, elementId: el.id, title: `Missing artwork on the ${label}`, detail: `“${file}” from the “${pack}” style pack is no longer installed, so it would be left out of the print. Delete it, or restore the pack in /data/styles.` });
        continue;
      }
      if (el.type === 'photo') {
        if (!el.fill) {
          if (el.managed) add({ check: 'content', severity: 'error', surfaceId: s.id, elementId: el.id, title: `Empty photo frame on the ${label}`, detail: 'Drop a photo into this frame, or switch to a template with fewer photos.', fix: 'fill-slot' });
          continue;
        }
        if (failed.has(el.fill.ref)) add({ check: 'content', severity: 'error', surfaceId: s.id, elementId: el.id, title: `A photo on the ${label} can’t be loaded`, detail: 'The original may have been moved or Immich is unreachable. Replace the photo or check Settings.', fix: 'replace-photo' });
        const box = photoContentBox(el);
        const dpi = photoDpi(el)!;
        const sev: Severity = dpi >= DPI_GOOD ? 'ok' : dpi >= DPI_MIN ? 'warn' : 'error';
        photos.push({ surfaceId: s.id, elementId: el.id, ref: el.fill.ref, dpi, severity: sev, printWidthIn: box.w, printHeightIn: box.h });
        if (sev !== 'ok')
          add({
            check: 'resolution', severity: sev === 'error' ? 'error' : 'warn', surfaceId: s.id, elementId: el.id,
            title: `${sev === 'error' ? 'Low' : 'Borderline'} resolution photo on the ${label} (${Math.round(dpi)} DPI)`,
            detail: sev === 'error'
              ? `This photo will look blurry or pixelated in print. Zoom out, use a smaller frame, or pick a higher-resolution original (needs ${DPI_GOOD}+ DPI).`
              : `Prints acceptably, but may look slightly soft up close. ${DPI_GOOD}+ DPI is ideal.`,
            fix: el.fill.crop.zoom > 1.05 ? 'zoom-out' : 'replace-photo',
          });

        // Faces
        const ov = orientedFill(el.fill);
        const faces = significantFaces(ov.faces, ov.width, ov.height);
        if (faces.length && !el.rotation) {
          const frame = { x: el.x + box.x, y: el.y + box.y, w: box.w, h: box.h };
          const onCard = facesOnCard(frame, ov.width, ov.height, el.fill.crop, faces);
          let worst: Severity = 'ok';
          let reason = '';
          for (const fc of onCard) {
            const a = fc.w * fc.h;
            const visible = area(intersect(fc, frame)) / a;
            const inTrim = area(intersect(fc, trim)) / a;
            const who = fc.personName ? `${fc.personName}’s face` : 'A face';
            if (visible < 0.6 || inTrim < 0.75) {
              worst = 'error';
              reason = `${who} is cut off by the ${inTrim < 0.75 ? 'card edge' : 'photo frame'}.`;
            } else if ((visible < 0.97 || !inside(safe, fc, 0)) && rank[worst] < rank.warn) {
              worst = 'warn';
              reason = `${who} is very close to the ${visible < 0.97 ? 'frame edge' : 'trim line'} and may be clipped.`;
            }
          }
          if (worst !== 'ok')
            add({ check: 'faces', severity: worst as 'warn' | 'error', surfaceId: s.id, elementId: el.id, title: `Face too close to the edge on the ${label}`, detail: `${reason} Use “Smart crop” or drag the photo to re-centre it.`, fix: 'smart-crop' });
        }
      } else if (el.type === 'text') {
        const resolved = resolveTokens(el.text, project);
        if (!resolved.trim()) continue;
        // Fonts
        const fam = el.fontFamily ?? project.theme.fonts[el.fontRole]?.family;
        if (fam && fonts.size && !fonts.has(fam.toLowerCase()))
          add({ check: 'fonts', severity: 'error', surfaceId: s.id, elementId: el.id, title: `Font “${fam}” is not installed`, detail: 'The print renderer would substitute another font. Re-add it to /data/fonts or choose another font.', fix: 'change-font' });
        // Placeholders
        const usesFamilyToken = /\{\{\s*family\s*\}\}/i.test(el.text) && !project.familyName.trim();
        const placeholder = usesFamilyToken || el.isPlaceholder || PLACEHOLDER_PATTERNS.some((re) => re.test(resolved));
        if (placeholder) {
          const sample = usesFamilyToken ? PLACEHOLDER_FAMILY : (resolved.match(/\[[^\]]+\]/)?.[0] ?? resolved.slice(0, 40));
          add({ check: 'placeholder', severity: 'error', surfaceId: s.id, elementId: el.id, title: `Placeholder text on the ${label}`, detail: `“${sample}” looks like sample text. ${usesFamilyToken ? 'Enter your family name in Card Setup, or edit this text.' : 'Replace it with your own words.'}`, fix: 'edit-text' });
        }
        // Safe zone
        const b = input.textBounds[el.id];
        if (b) {
          if (!inside(trim, b, 0.01))
            add({ check: 'safe-zone', severity: 'error', surfaceId: s.id, elementId: el.id, title: `Text runs past the trim on the ${label}`, detail: 'Part of this text will be cut off when the card is trimmed. Move it inward.', fix: 'move-inside' });
          else if (!inside(safe, b, 0.01))
            add({ check: 'safe-zone', severity: 'warn', surfaceId: s.id, elementId: el.id, title: `Text is inside the ${f.safeIn}" danger zone on the ${label}`, detail: 'Cutting machines can drift — keep text inside the dashed safe line.', fix: 'move-inside' });
        }
        // Overflow
        if (input.textOverflow[el.id])
          add({ check: 'overflow', severity: 'warn', surfaceId: s.id, elementId: el.id, title: `Text doesn’t fit its box on the ${label}`, detail: 'Shorten the text or make the box larger so nothing is cut off.', fix: 'fit-text' });
        // Contrast
        const cr = input.textContrast[el.id];
        if (cr !== undefined) {
          const large = isLargeText(el);
          const [okT, errT] = large ? [3, 2] : [4.5, 3];
          if (cr < okT)
            add({
              check: 'contrast', severity: cr < errT ? 'error' : 'warn', surfaceId: s.id, elementId: el.id,
              title: `Hard-to-read text on the ${label} (contrast ${cr.toFixed(1)}:1)`,
              detail: `Aim for at least ${okT}:1. “Make readable” lightens or darkens the colour just enough (and adds a soft shadow over photos).`,
              fix: 'readability',
            });
        }
      }
    }
  }

  const checks: GuardianCheck[] = (Object.keys(CHECK_META) as CheckId[]).map((id) => {
    const mine = issues.filter((i) => i.check === id);
    const status = mine.reduce<Severity>((acc, i) => (rank[i.severity] > rank[acc] ? i.severity : acc), 'ok');
    return { id, ...CHECK_META[id], status, issues: mine.length };
  });
  const worst = issues.reduce<Severity>((acc, i) => (rank[i.severity] > rank[acc] ? i.severity : acc), 'ok');
  issues.sort((a, b) => rank[b.severity] - rank[a.severity]);
  return { status: worst === 'error' ? 'red' : worst === 'warn' ? 'yellow' : 'green', checks, issues, photos };
}
