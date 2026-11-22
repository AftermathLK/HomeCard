import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import * as fontkit from 'fontkit';
import { BUNDLED_FONTS, type FontFamilyInfo } from '@homecard/shared';
import { config } from '../config';
import { emit } from '../events';
import { ensureDir, httpError, readJson, safeRealPath, sanitizeFileName, toPosix, uniquePath } from '../util/fsx';

interface FaceEntry {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  url: string;
  format: string;
  unicodeRange?: string;
  file: string;
  source: 'bundled' | 'custom';
}

const FONT_EXT = /\.(ttf|otf|woff2?|ttc)$/i;
let faces: FaceEntry[] = [];
let cssCache = '';
let version = Date.now();

const fmt = (file: string) =>
  /\.woff2$/i.test(file) ? 'woff2' : /\.woff$/i.test(file) ? 'woff' : /\.otf$/i.test(file) ? 'opentype' : 'truetype';

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/thin|hairline/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

function guessFromName(stem: string) {
  let weight = 400;
  for (const [re, w] of WEIGHT_WORDS) if (re.test(stem)) { weight = w; break; }
  const style: 'normal' | 'italic' = /italic|oblique/i.test(stem) ? 'italic' : 'normal';
  const family = stem
    .replace(/[-_ ]?(thin|hairline|extra.?light|ultra.?light|light|regular|book|medium|semi.?bold|demi.?bold|extra.?bold|ultra.?bold|bold|black|heavy|italic|oblique|variable|vf)+$/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return { family: family || stem, weight, style };
}

async function describeFont(abs: string): Promise<Array<{ family: string; weight: number; style: 'normal' | 'italic' }>> {
  const stem = path.basename(abs).replace(FONT_EXT, '');
  try {
    const opened: any = await (fontkit as any).open(abs);
    const list: any[] = opened?.fonts ?? [opened];
    return list.slice(0, 1).map((font) => {
      const name = (k: string) => {
        try {
          return font.getName?.(k) || null;
        } catch {
          return null;
        }
      };
      const family = name('preferredFamily') || font.familyName || guessFromName(stem).family;
      const os2 = font['OS/2'];
      const weight = Number(os2?.usWeightClass) || guessFromName(stem).weight;
      const sub = String(name('preferredSubfamily') || font.subfamilyName || '');
      const italic = !!os2?.fsSelection?.italic || /italic|oblique/i.test(sub) || (font.italicAngle ?? 0) !== 0;
      return { family: String(family).trim(), weight: Math.min(900, Math.max(100, Math.round(weight / 100) * 100)), style: italic ? 'italic' : 'normal' };
    });
  } catch {
    return [guessFromName(stem)];
  }
}

async function scanCustom(): Promise<FaceEntry[]> {
  await ensureDir(config.dirs.fonts);
  const out: FaceEntry[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 4) return;
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs, depth + 1);
      else if (e.isFile() && FONT_EXT.test(e.name) && !/\.ttc$/i.test(e.name)) {
        const rel = toPosix(path.relative(config.dirs.fonts, abs));
        for (const d of await describeFont(abs)) {
          out.push({ ...d, file: rel, url: `/fonts/custom/${rel.split('/').map(encodeURIComponent).join('/')}`, format: fmt(e.name), source: 'custom' });
        }
      }
    }
  }
  await walk(config.dirs.fonts, 0);
  return out;
}

async function loadBundled(): Promise<FaceEntry[]> {
  const manifest = await readJson<{ faces: Array<{ family: string; weight: number; style: 'normal' | 'italic'; file: string; unicodeRange?: string }> }>(
    path.join(config.assetsDir, 'fonts', 'manifest.json'),
    { faces: [] },
  );
  return manifest.faces.map((f) => ({ ...f, url: `/fonts/bundled/${encodeURIComponent(f.file)}`, format: fmt(f.file), source: 'bundled' as const }));
}

export async function rescanFonts() {
  const [bundled, custom] = await Promise.all([loadBundled(), scanCustom()]);
  faces = [...bundled, ...custom];
  version = Date.now();
  cssCache = faces.map(faceCss).join('\n');
  return faces;
}

/** Family names come from font files: strip anything that could escape the CSS string. */
const cssFamily = (s: string) => s.replace(/["'\\<>{}\u0000-\u001f]/g, '').slice(0, 100);
const cssRange = (s?: string) => (s && /^[U+0-9A-Fa-f,\s?-]+$/.test(s) ? `unicode-range:${s};` : '');

function faceCss(f: FaceEntry) {
  return `@font-face{font-family:"${cssFamily(f.family)}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("${f.url}") format("${f.format}");${cssRange(f.unicodeRange)}}`;
}

/** The interface fonts (used by the sign-in page before anyone is signed in). */
const UI_FAMILIES = new Set(['Work Sans', 'Playfair Display']);
const uiFaces = () => faces.filter((f) => f.source === 'bundled' && UI_FAMILIES.has(f.family));
export const uiFontFiles = () => uiFaces().map((f) => f.file);
export const uiFontsCss = () => uiFaces().map(faceCss).join('\n');

export function fontFamilies(): FontFamilyInfo[] {
  const map = new Map<string, FontFamilyInfo>();
  for (const f of faces) {
    const key = `${f.source}:${f.family}`;
    let fam = map.get(key);
    if (!fam) {
      const meta = BUNDLED_FONTS.find((b) => b.family === f.family);
      fam = { family: f.family, source: f.source, category: meta?.category ?? 'custom', faces: [] };
      map.set(key, fam);
    }
    if (!fam.faces.some((x) => x.weight === f.weight && x.style === f.style)) fam.faces.push({ weight: f.weight, style: f.style, file: f.file });
  }
  for (const fam of map.values()) fam.faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
  return [...map.values()].sort((a, b) => (a.source === b.source ? a.family.localeCompare(b.family) : a.source === 'custom' ? -1 : 1));
}

export function registerFontRoutes(app: FastifyInstance) {
  app.get('/api/fonts', async () => ({ version, families: fontFamilies() }));

  app.get('/api/fonts/fonts.css', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return reply.type('text/css; charset=utf-8').send(cssCache);
  });

  app.get<{ Params: { '*': string } }>('/fonts/bundled/*', async (req, reply) => {
    const rel = req.params['*'];
    if (!FONT_EXT.test(rel)) throw httpError(400, 'Not a font');
    const abs = await safeRealPath(path.join(config.assetsDir, 'fonts', 'files'), rel);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.type(`font/${fmt(abs) === 'truetype' ? 'ttf' : fmt(abs)}`).send(createReadStream(abs));
  });

  app.get<{ Params: { '*': string } }>('/fonts/custom/*', async (req, reply) => {
    const rel = decodeURIComponent(req.params['*']);
    if (!FONT_EXT.test(rel)) throw httpError(400, 'Not a font');
    const abs = await safeRealPath(config.dirs.fonts, rel);
    reply.header('Cache-Control', 'private, no-cache');
    const f = fmt(abs);
    return reply.type(f === 'truetype' ? 'font/ttf' : f === 'opentype' ? 'font/otf' : `font/${f}`).send(createReadStream(abs));
  });

  app.post('/api/fonts/rescan', async () => {
    await rescanFonts();
    emit('fonts', { version });
    return { version, families: fontFamilies() };
  });

  app.post('/api/fonts/upload', async (req) => {
    await ensureDir(config.dirs.fonts);
    const saved: string[] = [];
    const rejected: string[] = [];
    for await (const part of req.files({ limits: { fileSize: 30 * 1024 * 1024 } })) {
      const name = sanitizeFileName(part.filename);
      if (!FONT_EXT.test(name) || /\.ttc$/i.test(name)) {
        rejected.push(part.filename);
        part.file.resume();
        continue;
      }
      const dest = await uniquePath(config.dirs.fonts, name);
      await pipeline(part.file, createWriteStream(dest));
      saved.push(path.basename(dest));
    }
    await rescanFonts();
    emit('fonts', { version });
    return { saved, rejected, families: fontFamilies() };
  });
}
