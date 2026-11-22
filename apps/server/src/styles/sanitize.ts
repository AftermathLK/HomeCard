import { sha1 } from '../util/fsx';

/**
 * Allowlist SVG sanitizer for user-supplied artwork (style packs, uploaded ornaments/stickers and
 * backgrounds) before it is inlined in the editor or loaded by the headless print renderer.
 *
 * The markup is tokenised and rebuilt; only known-safe SVG elements and attributes are written back.
 *   - Dropped with their content: <script>, <foreignObject>, <iframe>/<embed>/<object>, media and
 *     canvas, animation elements (<animate>, <set>, …: they can rewrite href at runtime), <feImage>,
 *     <metadata>, editor-namespaced elements (inkscape:*, sodipodi:*), and anything unknown.
 *   - <a> is unwrapped (children kept, link removed).
 *   - Attributes: no event handlers (on*), no namespaced attributes except xlink:href/xml:space,
 *     href only as a local "#id" (or an embedded raster data: URI on <image>), so no http://,
 *     https:// or file:// references can make the renderer fetch anything.
 *   - CSS (style attributes and <style>): no @import, no external url(), no expression()/bindings.
 *   - DOCTYPE/ENTITY declarations, processing instructions, comments and CDATA wrappers are removed.
 * Element ids are namespaced so several inlined SVGs never collide.
 */

const KEEP = new Set(
  [
    'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'textPath', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
    'pattern', 'image', 'style', 'marker', 'filter', 'switch',
    'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
    'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
    'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting',
    'feSpotLight', 'feTile', 'feTurbulence',
  ].map((n) => n.toLowerCase()),
);
const UNWRAP = new Set(['a']);
const HREF_ELEMENTS = new Set(['use', 'image', 'textpath', 'lineargradient', 'radialgradient', 'pattern', 'filter']);
const ATTR_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ALLOWED_NS_ATTRS = new Set(['xlink:href', 'xml:space', 'xmlns:xlink']);
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function decodeEntities(v: string) {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16) || 0xfffd))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCodePoint(Number(d) || 0xfffd))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (v: string) => v.replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** CSS from a style attribute or <style> element: keep only self-contained rules. */
export function cleanCss(css: string, mapId: (id: string) => string = (id) => id): string {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Decode CSS escapes first: to a browser "u\\72l(" is "url(".
  s = s
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff) || 0xfffd))
    .replace(/\\(.)/g, '$1')
    .replace(/\\/g, '');
  s = s.replace(/@import[^;]*;?/gi, '');
  s = s.replace(/@font-face\s*\{[^}]*\}/gi, '');
  s = s.replace(/(-webkit-)?image-set\s*\([^)]*\)/gi, 'none').replace(/\bimage\s*\([^)]*\)/gi, 'none');
  s = s.replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (_m, _q, raw: string) => {
    const v = raw.trim();
    if (v.startsWith('#') && /^#[\w.:-]+$/.test(v)) return `url(#${mapId(v.slice(1))})`;
    if (DATA_IMAGE.test(v)) return `url("${v.replace(/\s+/g, '')}")`;
    return 'none';
  });
  s = s.replace(/expression\s*\(|javascript\s*:|vbscript\s*:|behaviou?r\s*:[^;}]*|-moz-binding[^;}]*/gi, '');
  return s.replace(/[<>]/g, '');
}

interface Tag {
  kind: 'open' | 'close' | 'self';
  name: string;
  attrs: Array<[string, string]>;
}
type Token = Tag | { kind: 'text'; text: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      out.push({ kind: 'text', text: src.slice(i) });
      break;
    }
    if (lt > i) out.push({ kind: 'text', text: src.slice(i, lt) });
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      out.push({ kind: 'text', text: escText(src.slice(lt + 9, end < 0 ? src.length : end)) });
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      // DOCTYPE (possibly with an internal subset), ENTITY, processing instructions
      let depth = 0;
      let j = lt + 2;
      for (; j < src.length; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        else if (src[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + 1;
    let quote: string | null = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;
    if (inner.startsWith('/')) {
      out.push({ kind: 'close', name: inner.slice(1).trim().toLowerCase(), attrs: [] });
      continue;
    }
    const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
    if (!m) continue;
    const selfClosing = /\/\s*$/.test(m[2]);
    const attrSrc = selfClosing ? m[2].replace(/\/\s*$/, '') : m[2];
    const attrs: Array<[string, string]> = [];
    const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = re.exec(attrSrc))) attrs.push([a[1], decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')]);
    out.push({ kind: selfClosing ? 'self' : 'open', name: m[1], attrs });
  }
  return out;
}

export function sanitizeSvg(input: string, namespaceSeed: string): string {
  const src = input.replace(/^﻿/, '');
  if (!/<svg[\s>]/i.test(src)) throw new Error('Not an SVG file');
  const tokens = tokenize(src);
  const ns = `hc${sha1(namespaceSeed).slice(0, 6)}_`;
  const ids = new Set<string>();
  for (const t of tokens) if (t.kind !== 'text') for (const [k, v] of t.attrs) if (k.toLowerCase() === 'id') ids.add(v);
  const mapId = (id: string) => (ids.has(id) ? `${ns}${id}` : id);

  const out: string[] = [];
  // Stack of open elements: what we did with each (kept / unwrapped / dropped subtree).
  const stack: Array<{ name: string; mode: 'keep' | 'unwrap' | 'drop' }> = [];
  let dropDepth = 0;
  let inStyle = false;
  let sawRoot = false;

  const cleanAttrs = (el: string, attrs: Array<[string, string]>, isRoot: boolean) => {
    const kept: string[] = [];
    let hasViewBox = false;
    let w: string | undefined;
    let h: string | undefined;
    for (const [rawName, value] of attrs) {
      const name = rawName.toLowerCase();
      if (name.startsWith('on')) continue;
      if (name.includes(':') && !ALLOWED_NS_ATTRS.has(name)) continue;
      if (!name.includes(':') && !ATTR_NAME.test(rawName)) continue;
      if (name === 'xmlns:xlink' || name === 'xmlns') {
        if (isRoot) kept.push(`${rawName}="${escAttr(value)}"`);
        continue;
      }
      if (name === 'href' || name === 'xlink:href') {
        const v = value.trim();
        if (!HREF_ELEMENTS.has(el)) continue;
        if (v.startsWith('#') && /^#[\w.:-]+$/.test(v)) kept.push(`${rawName}="#${escAttr(mapId(v.slice(1)))}"`);
        else if (el === 'image' && DATA_IMAGE.test(v)) kept.push(`${rawName}="${escAttr(v.replace(/\s+/g, ''))}"`);
        continue;
      }
      if (isRoot && (name === 'width' || name === 'height')) {
        if (name === 'width') w = value;
        else h = value;
        continue;
      }
      if (name === 'viewbox') hasViewBox = true;
      if (name === 'id') {
        kept.push(`id="${escAttr(mapId(value))}"`);
        continue;
      }
      if (name === 'style') {
        const css = cleanCss(value, mapId);
        if (css.trim()) kept.push(`style="${escAttr(css)}"`);
        continue;
      }
      // Any other value that references something must point inside this SVG.
      let v = value;
      if (/url\s*\(/i.test(v)) v = cleanCss(v, mapId);
      if (/^\s*(javascript|vbscript|data|file|https?):/i.test(v)) continue;
      kept.push(`${rawName}="${escAttr(v)}"`);
    }
    if (isRoot) {
      if (!hasViewBox) {
        const wn = Number.parseFloat(w ?? '');
        const hn = Number.parseFloat(h ?? '');
        if (wn > 0 && hn > 0) kept.push(`viewBox="0 0 ${wn} ${hn}"`);
      }
      kept.push('width="100%"', 'height="100%"');
    }
    return kept.length ? ` ${kept.join(' ')}` : '';
  };

  for (const t of tokens) {
    if (t.kind === 'text') {
      if (dropDepth) continue;
      if (inStyle) out.push(cleanCss(decodeEntities(t.text), mapId));
      else if (sawRoot) out.push(escText(t.text));
      continue;
    }
    const lname = t.name.toLowerCase();
    if (t.kind === 'close') {
      // Pop to the matching element (tolerates sloppy nesting).
      let idx = -1;
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === lname) { idx = k; break; }
      if (idx < 0) continue;
      while (stack.length > idx) {
        const e = stack.pop()!;
        if (e.mode === 'drop') dropDepth--;
        else if (e.mode === 'keep') {
          if (!dropDepth) out.push(`</${e.name === 'svg' ? 'svg' : originalCase(e.name)}>`);
          if (e.name === 'style') inStyle = false;
        }
      }
      continue;
    }
    let mode: 'keep' | 'unwrap' | 'drop';
    if (dropDepth) mode = 'drop';
    else if (!sawRoot) mode = lname === 'svg' ? 'keep' : 'drop';
    else if (lname.includes(':')) mode = 'drop';
    else if (KEEP.has(lname)) mode = 'keep';
    else if (UNWRAP.has(lname)) mode = 'unwrap';
    else mode = 'drop';
    const isRoot = !sawRoot && lname === 'svg';
    if (mode === 'keep') {
      if (isRoot) sawRoot = true;
      out.push(`<${originalCase(lname)}${cleanAttrs(lname, t.attrs, isRoot)}${t.kind === 'self' ? '/>' : '>'}`);
      if (t.kind === 'open') {
        stack.push({ name: lname, mode });
        if (lname === 'style') inStyle = true;
      }
    } else if (t.kind === 'open') {
      stack.push({ name: lname, mode });
      if (mode === 'drop') dropDepth++;
    }
  }
  // Close anything left open.
  while (stack.length) {
    const e = stack.pop()!;
    if (e.mode === 'keep' && !dropDepth) out.push(`</${originalCase(e.name)}>`);
    if (e.mode === 'drop') dropDepth--;
  }
  if (!sawRoot) throw new Error('Not an SVG file');
  return out.join('').trim();
}

const CASED = new Map(
  [
    'clipPath', 'linearGradient', 'radialGradient', 'textPath', 'feBlend', 'feColorMatrix', 'feComponentTransfer',
    'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow',
    'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology',
    'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  ].map((n) => [n.toLowerCase(), n]),
);
const originalCase = (lname: string) => CASED.get(lname) ?? lname;
