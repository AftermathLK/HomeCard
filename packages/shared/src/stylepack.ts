/**
 * Style Pack schema. A Style Pack is a folder in /data/styles containing `pack.json`
 * (or a single standalone `*.json` file) plus any referenced SVG/PNG/JPG assets.
 * See docs/STYLE_PACKS.md for the full documentation.
 */
import type { FoilDef } from './color';
import { palette } from './harmony';
import type { FontPairing } from './fonts';
import type { OrnamentKind } from './ornaments';
import type { CustomTemplateJson } from './templates/types';
import type { FontSpec, ThemeColors } from './types';

export interface StylePackManifest {
  $schema?: string;
  id: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
  license?: string;
  /** Occasion ids this pack is recommended for (empty = all). */
  occasions?: string[];
  palettes?: Array<{ id: string; name: string; colors: Partial<ThemeColors> & { background: string; text: string; accent: string } }>;
  backgrounds?: Array<{
    id: string;
    name: string;
    file: string;
    /** tile = repeat at tileSizeIn; cover = stretch to the card. */
    mode?: 'tile' | 'cover';
    tileSizeIn?: number;
    /** overlay = semi-transparent texture laid over the background colour; image = opaque picture. */
    kind?: 'overlay' | 'image';
    tone?: 'light' | 'dark';
  }>;
  foils?: Array<{ id: string; name: string; gradient?: string; stops?: string[]; angle?: number; texture?: string; mid?: string }>;
  ornaments?: Array<{ id: string; name: string; file: string; kind?: OrnamentKind; recolorable?: boolean; tags?: string[]; stretch?: boolean }>;
  stickers?: Array<{ id: string; name: string; file: string; tags?: string[] }>;
  templates?: Array<string | CustomTemplateJson>;
  fontPairings?: Array<{ id: string; name: string; mood?: string; display: FontSpec; body: FontSpec; accent: FontSpec }>;
}

export interface PackAsset {
  id: string;
  name: string;
  /** Portable reference stored in projects: "pack:<packId>/<file>". */
  asset: string;
  url: string;
  file: string;
}

export interface ResolvedStylePack {
  id: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
  license?: string;
  occasions: string[];
  source: 'pack' | 'uploads' | 'starter';
  palettes: Array<{ id: string; name: string; colors: ThemeColors }>;
  backgrounds: Array<PackAsset & { mode: 'tile' | 'cover'; tileSizeIn: number; kind: 'overlay' | 'image'; tone?: 'light' | 'dark' }>;
  foils: FoilDef[];
  ornaments: Array<PackAsset & { kind: OrnamentKind; recolorable: boolean; tags: string[]; stretch?: boolean }>;
  stickers: Array<PackAsset & { tags: string[] }>;
  templates: CustomTemplateJson[];
  fontPairings: FontPairing[];
  errors: string[];
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_FILE = /^(?!\/)(?!.*\.\.)[\w\-./ ]+\.(svg|png|jpe?g|webp)$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9\-_]{0,63}$/i;

export function packAssetRef(packId: string, file: string) {
  return `pack:${packId}/${file}`;
}
export function parsePackAssetRef(ref: string): { packId: string; file: string } | null {
  const m = /^pack:([^/]+)\/(.+)$/.exec(ref);
  return m ? { packId: m[1], file: m[2] } : null;
}
export function packFileUrl(packId: string, file: string) {
  return `/api/styles/file/${encodeURIComponent(packId)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/** Validate + normalise a manifest. Unknown/invalid entries are dropped with an error message. */
export function resolveStylePack(raw: unknown, source: ResolvedStylePack['source'] = 'pack'): ResolvedStylePack {
  const errors: string[] = [];
  const m = (raw ?? {}) as StylePackManifest;
  const id = typeof m.id === 'string' && SAFE_ID.test(m.id) ? m.id : '';
  if (!id) errors.push('Missing or invalid "id" (letters, numbers, dashes).');
  const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : id || 'Untitled pack';
  const okFile = (file: unknown, what: string) => {
    if (typeof file === 'string' && SAFE_FILE.test(file)) return true;
    errors.push(`${what}: invalid file path "${String(file)}" (must be a relative .svg/.png/.jpg/.webp path).`);
    return false;
  };
  const asset = (file: string) => ({ asset: packAssetRef(id, file), url: packFileUrl(id, file), file });

  const palettes = (Array.isArray(m.palettes) ? m.palettes : [])
    .filter((p) => {
      const ok = p && typeof p.id === 'string' && p.colors && HEX.test(p.colors.background ?? '') && HEX.test(p.colors.text ?? '') && HEX.test(p.colors.accent ?? '');
      if (!ok) errors.push(`Palette "${p?.id ?? '?'}" needs hex background, text and accent colours.`);
      return ok;
    })
    .map((p) => {
      const base = palette(p.colors.background, p.colors.text, p.colors.accent, p.colors.accent2 && HEX.test(p.colors.accent2) ? p.colors.accent2 : p.colors.accent, p.colors.surface);
      const colors = { ...base };
      for (const k of Object.keys(p.colors) as Array<keyof ThemeColors>) if (HEX.test(p.colors[k] ?? '')) colors[k] = p.colors[k]!;
      return { id: `${id}:${p.id}`, name: p.name ?? p.id, colors };
    });

  const backgrounds = (Array.isArray(m.backgrounds) ? m.backgrounds : [])
    .filter((b) => b && typeof b.id === 'string' && okFile(b.file, `Background "${b?.id}"`))
    .map((b) => ({
      id: `${id}:${b.id}`,
      name: b.name ?? b.id,
      ...asset(b.file),
      mode: b.mode === 'cover' ? ('cover' as const) : ('tile' as const),
      tileSizeIn: typeof b.tileSizeIn === 'number' && b.tileSizeIn > 0 ? b.tileSizeIn : 2,
      kind: b.kind === 'image' ? ('image' as const) : ('overlay' as const),
      tone: b.tone,
    }));

  const foils: FoilDef[] = (Array.isArray(m.foils) ? m.foils : [])
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => {
      let gradient = typeof f.gradient === 'string' && /^(linear|radial|conic)-gradient\(/.test(f.gradient) ? f.gradient : '';
      if (!gradient && Array.isArray(f.stops) && f.stops.every((s) => HEX.test(s))) {
        gradient = `linear-gradient(${typeof f.angle === 'number' ? f.angle : 135}deg, ${f.stops.join(', ')})`;
      }
      if (!gradient) errors.push(`Foil "${f.id}" needs "gradient" or hex "stops".`);
      const texture = f.texture && okFile(f.texture, `Foil "${f.id}" texture`) ? packFileUrl(id, f.texture) : null;
      return { id: `pack:${id}/${f.id}`, name: f.name ?? f.id, gradient, mid: f.mid && HEX.test(f.mid) ? f.mid : (f.stops?.[Math.floor((f.stops?.length ?? 1) / 2)] ?? '#c9a54a'), texture };
    })
    .filter((f) => !!f.gradient);

  const ornaments = (Array.isArray(m.ornaments) ? m.ornaments : [])
    .filter((o) => o && typeof o.id === 'string' && okFile(o.file, `Ornament "${o?.id}"`))
    .map((o) => ({
      id: `${id}:${o.id}`,
      name: o.name ?? o.id,
      ...asset(o.file),
      kind: (o.kind ?? 'ornament') as OrnamentKind,
      recolorable: o.recolorable !== false && /\.svg$/i.test(o.file),
      tags: Array.isArray(o.tags) ? o.tags : [],
      stretch: !!o.stretch || o.kind === 'frame',
    }));

  const stickers = (Array.isArray(m.stickers) ? m.stickers : [])
    .filter((s) => s && typeof s.id === 'string' && okFile(s.file, `Sticker "${s?.id}"`))
    .map((s) => ({ id: `${id}:${s.id}`, name: s.name ?? s.id, ...asset(s.file), tags: Array.isArray(s.tags) ? s.tags : [] }));

  const templates = (Array.isArray(m.templates) ? m.templates : []).filter((t): t is CustomTemplateJson => {
    const ok = typeof t === 'object' && !!t && typeof (t as any).id === 'string' && !!(t as any).layouts && typeof (t as any).layouts === 'object';
    if (!ok) errors.push(`Template ${typeof t === 'string' ? `"${t}"` : `"${(t as any)?.id ?? '?'}"`} could not be loaded (needs "id" and "layouts").`);
    return ok;
  });
  // Pack artwork used by templates must be declared, so it is listed, validated and checked before print.
  const declared = new Set(ornaments.map((o) => o.asset));
  for (const t of templates) {
    for (const els of Object.values(t.layouts)) {
      for (const e of els ?? []) {
        if (e?.type === 'ornament' && typeof e.asset === 'string' && e.asset.startsWith(`pack:${id}/`) && !declared.has(e.asset))
          errors.push(`Template "${t.id}" uses ${e.asset.slice(`pack:${id}/`.length)}, which is not listed under "ornaments".`);
      }
    }
  }

  const fontPairings: FontPairing[] = (Array.isArray(m.fontPairings) ? m.fontPairings : [])
    .filter((p) => p && p.display?.family && p.body?.family && p.accent?.family)
    .map((p) => ({ id: `${id}:${p.id}`, name: p.name ?? p.id, mood: p.mood ?? 'Custom', display: p.display, body: p.body, accent: p.accent }));

  return {
    id,
    name,
    version: m.version,
    author: m.author,
    description: m.description,
    license: m.license,
    occasions: Array.isArray(m.occasions) ? m.occasions : [],
    source,
    palettes,
    backgrounds,
    foils,
    ornaments,
    stickers,
    templates,
    fontPairings,
    errors,
  };
}
