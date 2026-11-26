/**
 * Test helper: lays card text out from the real glyph widths of the bundled fonts, the way the
 * card renderer's CSS does (pre-wrap lines, unitless line-height, letter-spacing after every
 * character, uppercase transform). Kerning is ignored, which makes words measure slightly wide.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { BUNDLED_FONTS, type FontSpec } from '../src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));

/** Tables of a WOFF 1.0 file (zlib-compressed sfnt tables). */
function woffTables(buf: Buffer): Map<string, Buffer> {
  if (buf.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF 1.0 file');
  const tables = new Map<string, Buffer>();
  for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString('latin1', o, o + 4);
    const off = buf.readUInt32BE(o + 4);
    const comp = buf.readUInt32BE(o + 8);
    const orig = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(off, off + comp);
    tables.set(tag, comp < orig ? inflateSync(raw) : raw);
  }
  return tables;
}

/** Unicode code point -> glyph id, from a format 4 or format 12 Unicode cmap subtable. */
function readCmap(cmap: Buffer, into: Map<number, number>) {
  let sub = -1;
  let subFormat = 0;
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const pid = cmap.readUInt16BE(4 + i * 8);
    const eid = cmap.readUInt16BE(6 + i * 8);
    const off = cmap.readUInt32BE(8 + i * 8);
    if (!(pid === 0 || (pid === 3 && (eid === 1 || eid === 10)))) continue;
    const format = cmap.readUInt16BE(off);
    if (format === 12 || (format === 4 && subFormat !== 12)) [sub, subFormat] = [off, format];
  }
  if (sub < 0) throw new Error('no Unicode cmap');
  if (subFormat === 12) {
    for (let g = 0, n = cmap.readUInt32BE(sub + 12); g < n; g++) {
      const o = sub + 16 + g * 12;
      const start = cmap.readUInt32BE(o);
      const end = cmap.readUInt32BE(o + 4);
      const gid = cmap.readUInt32BE(o + 8);
      for (let cp = start; cp <= end; cp++) if (!into.has(cp)) into.set(cp, gid + cp - start);
    }
    return;
  }
  const segX2 = cmap.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = cmap.readUInt16BE(ends + s * 2);
    const start = cmap.readUInt16BE(starts + s * 2);
    const delta = cmap.readInt16BE(deltas + s * 2);
    const ro = cmap.readUInt16BE(ranges + s * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let gid: number;
      if (ro === 0) gid = (cp + delta) & 0xffff;
      else {
        const g = cmap.readUInt16BE(ranges + s * 2 + ro + 2 * (cp - start));
        gid = g ? (g + delta) & 0xffff : 0;
      }
      if (gid && !into.has(cp)) into.set(cp, gid);
    }
  }
}

export interface Face {
  id: string;
  /** Width of a string in em (no letter-spacing). */
  em(s: string): number;
}

/** CSS font matching for weights: the nearest bundled weight, in the order browsers try them. */
function matchWeight(want: number, have: number[]): number {
  if (have.includes(want)) return want;
  const up = have.filter((w) => w > want).sort((a, b) => a - b);
  const down = have.filter((w) => w < want).sort((a, b) => b - a);
  if (want >= 400 && want <= 500) {
    const mid = up.filter((w) => w <= 500);
    return mid[0] ?? down[0] ?? up[0];
  }
  return (want > 500 ? (up[0] ?? down[0]) : (down[0] ?? up[0]))!;
}

const faces = new Map<string, Face>();

/** The bundled face the renderer draws `font` with (latin + latin-ext subsets). */
export function loadFace(font: Pick<FontSpec, 'family' | 'weight' | 'style'>): Face {
  const bundled = BUNDLED_FONTS.find((b) => b.family === font.family);
  if (!bundled) throw new Error(`font “${font.family}” is not bundled`);
  const weight = matchWeight(font.weight, bundled.weights);
  const style = font.style === 'italic' && bundled.italics ? 'italic' : 'normal';
  const id = `${bundled.family}|${weight}|${style}`;
  const cached = faces.get(id);
  if (cached) return cached;

  const dir = path.join(path.dirname(require.resolve(`${bundled.pkg}/package.json`)), 'files');
  const slug = bundled.pkg.split('/')[1];
  const glyphs = new Map<number, number>();
  let upem = 0;
  let advances: number[] = [];
  for (const subset of ['latin', 'latin-ext']) {
    const file = path.join(dir, `${slug}-${subset}-${weight}-${style}.woff`);
    if (!existsSync(file)) continue;
    const t = woffTables(readFileSync(file));
    // Subsets of one face share glyph ids and advances; the latin file comes first and wins.
    if (!upem) {
      upem = t.get('head')!.readUInt16BE(18);
      const numH = t.get('hhea')!.readUInt16BE(34);
      const hmtx = t.get('hmtx')!;
      advances = Array.from({ length: numH }, (_, i) => hmtx.readUInt16BE(i * 4));
      readCmap(t.get('cmap')!, glyphs);
    }
  }
  if (!upem) throw new Error(`no WOFF files for ${id} in ${dir}`);
  const adv = (gid: number) => advances[Math.min(gid, advances.length - 1)] / upem;
  // A character the font lacks falls back to another font; count it as an average letter.
  const letters = [...'etaoinshrdlu'].map((c) => adv(glyphs.get(c.codePointAt(0)!) ?? 0));
  const fallback = letters.reduce((a, b) => a + b, 0) / letters.length;
  const memo = new Map<string, number>();
  const face: Face = {
    id,
    em(s) {
      let w = memo.get(s);
      if (w === undefined) {
        w = 0;
        for (const ch of s) {
          const gid = glyphs.get(ch.codePointAt(0)!);
          w += gid === undefined ? fallback : adv(gid);
        }
        memo.set(s, w);
      }
      return w;
    },
  };
  faces.set(id, face);
  return face;
}

/** Half a CSS pixel, the slack the renderer allows when it checks a fit, in points. */
export const FIT_SLACK_PT = 0.5 * (72 / 96);

export interface LaidOutText {
  /** The words as drawn (after the uppercase transform). */
  words: string[];
  /** Width of a word at `pt` points, in points. */
  wordWidth(word: string, pt: number): number;
  /** Whether the text fits a `wIn` × `hIn` box at `pt` points (see TextFitProbe). */
  fits(pt: number, wholeWords: boolean): boolean;
}

/**
 * Text set in a box the way the renderer's CSS sets it: `white-space: pre-wrap`, lines break at
 * spaces, and only when `wholeWords` is off may a word too wide for the box break between letters.
 */
export function layOut(
  text: string,
  font: Pick<FontSpec, 'family' | 'weight' | 'style' | 'letterSpacing' | 'transform'>,
  box: { wIn: number; hIn: number; lineHeight: number },
): LaidOutText {
  const face = loadFace(font);
  const shown = font.transform === 'uppercase' ? text.toUpperCase() : text;
  const ls = font.letterSpacing ?? 0;
  const paragraphs = shown.split('\n').map((p) => p.split(' '));
  const charsOf = (s: string) => [...s].length;
  const emOf = (s: string) => face.em(s) + ls * charsOf(s);
  const space = emOf(' ');
  const W = box.wIn * 72 + FIT_SLACK_PT;
  const H = box.hIn * 72 + FIT_SLACK_PT;
  return {
    words: paragraphs.flat().filter(Boolean),
    wordWidth: (word, pt) => emOf(word) * pt,
    fits(pt, wholeWords) {
      let lines = 0;
      for (const words of paragraphs) {
        lines++;
        let line = 0; // em
        for (const word of words) {
          const w = emOf(word);
          if (w * pt > W) {
            if (wholeWords) return false;
            // overflow-wrap: break-word — the word starts a fresh line and breaks between letters.
            if (line > 0) lines++;
            line = 0;
            for (const ch of word) {
              const c = emOf(ch);
              if (line > 0 && (line + c) * pt > W) {
                lines++;
                line = 0;
              }
              line += c;
            }
            continue;
          }
          if (line === 0 && !word) continue;
          const next = line === 0 ? w : line + space + w;
          if (line > 0 && next * pt > W) {
            lines++;
            line = w;
          } else line = next;
        }
      }
      return lines * box.lineHeight * pt <= H;
    },
  };
}
