/**
 * Built-in vector ornaments, generated procedurally so they stay crisp at any print size.
 * Primary colour = currentColor; secondary colour = CSS var --hc-orn2 (falls back to primary).
 * No element ids are used, so ornaments can be inlined many times on one page safely.
 */
import { prng } from './harmony';

export type OrnamentKind = 'ornament' | 'divider' | 'corner' | 'frame' | 'scatter';

export interface OrnamentDef {
  id: string;
  name: string;
  kind: OrnamentKind;
  tags: string[];
  /** width / height of the artwork. */
  aspect: number;
  twoTone: boolean;
  /** Stretch to the element box (frames). */
  stretch?: boolean;
  svg: string;
}

const P = 'fill:currentColor';
const S = 'fill:var(--hc-orn2, currentColor)';
const SP = 'fill:none;stroke:currentColor';
const SS = 'fill:none;stroke:var(--hc-orn2, currentColor)';
const n = (v: number) => Math.round(v * 100) / 100;

function svg(body: string, vb = '0 0 100 100', stretch = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="${stretch ? 'none' : 'xMidYMid meet'}" style="display:block;overflow:visible">${body}</svg>`;
}

const rotAll = (count: number, fn: (i: number, deg: number) => string, cx = 50, cy = 50, offset = 0) =>
  Array.from({ length: count }, (_, i) => {
    const deg = offset + (360 / count) * i;
    return `<g transform="rotate(${n(deg)} ${cx} ${cy})">${fn(i, deg)}</g>`;
  }).join('');

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

function starPoints(cx: number, cy: number, outer: number, inner: number, points = 5, rot = -90) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const [x, y] = polar(cx, cy, r, rot + (180 / points) * i);
    pts.push(`${n(x)},${n(y)}`);
  }
  return pts.join(' ');
}

const flame = (x: number, y: number, s: number, style = S) =>
  `<path style="${style}" d="M${n(x)} ${n(y - s * 1.7)} C${n(x + s)} ${n(y - s * 0.6)} ${n(x + s * 0.85)} ${n(y + s * 0.35)} ${n(x)} ${n(y + s * 0.45)} C${n(x - s * 0.85)} ${n(y + s * 0.35)} ${n(x - s)} ${n(y - s * 0.6)} ${n(x)} ${n(y - s * 1.7)}Z"/>`;

/** Simple leaf from (0,0) to (len,0) with half-width w — placed via transform. */
const leaf = (len: number, w: number, style = P) =>
  `<path style="${style}" d="M0 0 Q${n(len / 2)} ${n(-w)} ${n(len)} 0 Q${n(len / 2)} ${n(w)} 0 0Z"/>`;

const heartPath = 'M50 88 C22 66 6 48 6 31 C6 16 17 6 30 6 C39 6 46 11 50 19 C54 11 61 6 70 6 C83 6 94 16 94 31 C94 48 78 66 50 88Z';

function crescentPath(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) {
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const px = x1 + (a * dx) / d, py = y1 + (a * dy) / d;
  const ix1 = px + (-dy / d) * h, iy1 = py + (dx / d) * h;
  const ix2 = px - (-dy / d) * h, iy2 = py - (dx / d) * h;
  return `M${n(ix1)} ${n(iy1)} A${r1} ${r1} 0 1 1 ${n(ix2)} ${n(iy2)} A${r2} ${r2} 0 0 0 ${n(ix1)} ${n(iy1)}Z`;
}

function hollyLeaf(len: number, w: number) {
  const L = len, W = w;
  return `M${L} 0 Q${n(L * 0.88)} ${n(-W * 0.35)} ${n(L * 0.76)} ${n(-W)} Q${n(L * 0.66)} ${n(-W * 0.45)} ${n(L * 0.52)} ${n(-W)} Q${n(L * 0.4)} ${n(-W * 0.45)} ${n(L * 0.27)} ${n(-W * 0.9)} Q${n(L * 0.12)} ${n(-W * 0.4)} 0 0 Q${n(L * 0.12)} ${n(W * 0.4)} ${n(L * 0.27)} ${n(W * 0.9)} Q${n(L * 0.4)} ${n(W * 0.45)} ${n(L * 0.52)} ${n(W)} Q${n(L * 0.66)} ${n(W * 0.45)} ${n(L * 0.76)} ${n(W)} Q${n(L * 0.88)} ${n(W * 0.35)} ${L} 0Z`;
}

/** Leaves distributed along a circular arc (used by laurel & wreath). */
function arcLeaves(cx: number, cy: number, r: number, from: number, to: number, count: number, len: number, w: number, style = P) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / Math.max(1, count - 1);
    const [x, y] = polar(cx, cy, r, t);
    const dir = to > from ? 90 : -90;
    const side = i % 2 === 0 ? -28 : 28;
    out += `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(t + dir + side)})">${leaf(len, w, style)}</g>`;
  }
  return out;
}

function quadPoint(p0: number[], p1: number[], p2: number[], t: number) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}
function quadTangent(p0: number[], p1: number[], p2: number[], t: number) {
  return [2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
}

/* ------------------------------------------------------------------ */

const defs: Array<Omit<OrnamentDef, 'svg' | 'aspect' | 'twoTone'> & { svg: string; vb?: string; twoTone?: boolean }> = [];
const add = (d: (typeof defs)[number]) => defs.push(d);

// Snowflake (classic)
add({
  id: 'snowflake', name: 'Snowflake', kind: 'ornament', tags: ['winter', 'christmas', 'holiday', 'solstice', 'new-year'],
  svg: `<g style="${SP}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${rotAll(6, () =>
    `<path d="M50 50 V8 M50 30 L39 19 M50 30 L61 19 M50 18 L43 11 M50 18 L57 11 M50 42 L44 37 M50 42 L56 37"/>`)}<circle cx="50" cy="50" r="5"/></g>`,
});
// Snowflake (crystal)
add({
  id: 'snowflake-crystal', name: 'Crystal Snowflake', kind: 'ornament', tags: ['winter', 'christmas', 'holiday', 'solstice'],
  svg: `${rotAll(6, () => `<path style="${P}" d="M48.6 50 V14 L50 6 L51.4 14 V50Z"/><path style="${P}" d="M50 12 l-5 -3 l1 6Z M50 12 l5 -3 l-1 6Z"/><path style="${SP}" stroke-width="2.2" stroke-linecap="round" d="M50 26 L40 18 M50 26 L60 18 M50 38 L43 33 M50 38 L57 33"/><path style="${S}" d="M50 20 l3 3 l-3 3 l-3 -3Z"/>`)}<circle style="${S}" cx="50" cy="50" r="5"/>`,
});
// Stars
add({ id: 'star', name: 'Star', kind: 'ornament', tags: ['christmas', 'july-4', 'new-year', 'graduation', 'holiday'], svg: `<polygon style="${P}" points="${starPoints(50, 53, 46, 19)}"/>` });
add({ id: 'star-outline', name: 'Outline Star', kind: 'ornament', tags: ['christmas', 'july-4', 'holiday'], svg: `<polygon style="${SP}" stroke-width="4" stroke-linejoin="round" points="${starPoints(50, 53, 44, 18)}"/>` });
add({ id: 'sparkle', name: 'Sparkle', kind: 'ornament', tags: ['new-year', 'christmas', 'wedding', 'holiday', 'birthday', 'any'], svg: `<path style="${P}" d="M50 3 Q54 46 97 50 Q54 54 50 97 Q46 54 3 50 Q46 46 50 3Z"/>` });
add({
  id: 'sparkles', name: 'Sparkle Trio', kind: 'ornament', tags: ['new-year', 'christmas', 'wedding', 'holiday', 'any', 'birthday'], twoTone: true,
  svg: `<path style="${P}" d="M40 10 Q43 44 76 48 Q43 52 40 86 Q37 52 4 48 Q37 44 40 10Z"/><path style="${S}" d="M78 6 Q79.6 20 94 22 Q79.6 24 78 38 Q76.4 24 62 22 Q76.4 20 78 6Z"/><path style="${S}" d="M80 64 Q81 74 91 75 Q81 76 80 86 Q79 76 69 75 Q79 74 80 64Z"/>`,
});
// Holly
add({
  id: 'holly', name: 'Holly', kind: 'ornament', tags: ['christmas', 'holiday', 'winter'], twoTone: true,
  svg: `<g transform="translate(50 52) rotate(200)"><path style="${P}" d="${hollyLeaf(44, 15)}"/></g><g transform="translate(50 52) rotate(-20)"><path style="${P}" d="${hollyLeaf(44, 15)}"/></g><circle style="${S}" cx="44" cy="46" r="8"/><circle style="${S}" cx="57" cy="44" r="8"/><circle style="${S}" cx="51" cy="57" r="8"/>`,
});
// Pine branch
add({
  id: 'pine-branch', name: 'Pine Branch', kind: 'ornament', tags: ['christmas', 'winter', 'holiday', 'solstice'],
  svg: (() => {
    const p0 = [8, 88], p1 = [40, 40], p2 = [94, 14];
    let needles = '';
    for (let i = 1; i <= 26; i++) {
      const t = i / 27;
      const [x, y] = quadPoint(p0, p1, p2, t);
      const [tx, ty] = quadTangent(p0, p1, p2, t);
      const ang = Math.atan2(ty, tx);
      const len = 16 * (1 - t * 0.45);
      for (const side of [-1, 1]) {
        const a = ang + side * 0.85;
        needles += `M${n(x)} ${n(y)} L${n(x + Math.cos(a) * len)} ${n(y + Math.sin(a) * len)} `;
      }
    }
    return `<path style="${SP}" stroke-width="3.2" stroke-linecap="round" d="M8 88 Q40 40 94 14"/><path style="${SP}" stroke-width="1.7" stroke-linecap="round" d="${needles}"/>`;
  })(),
});
// Bauble
add({
  id: 'bauble', name: 'Ornament Bauble', kind: 'ornament', tags: ['christmas', 'holiday'], twoTone: true,
  svg: `<circle style="${SP}" stroke-width="2.4" cx="50" cy="9" r="5"/><rect style="${S}" x="41" y="13" width="18" height="11" rx="2"/><circle style="${P}" cx="50" cy="60" r="36"/><path style="${S}" d="M14.6 54 H85.4 A36 36 0 0 1 86 60 A36 36 0 0 1 85.4 66 H14.6 A36 36 0 0 1 14 60 A36 36 0 0 1 14.6 54Z"/><ellipse style="fill:#ffffff;opacity:.28" cx="36" cy="42" rx="8" ry="12" transform="rotate(35 36 42)"/>`,
});
// Christmas tree
add({
  id: 'tree', name: 'Christmas Tree', kind: 'ornament', tags: ['christmas', 'holiday', 'winter'], twoTone: true,
  svg: `<polygon style="${P}" points="50,14 72,44 28,44"/><polygon style="${P}" points="50,28 80,66 20,66"/><polygon style="${P}" points="50,44 88,88 12,88"/><rect style="${P}" x="44" y="88" width="12" height="9"/><polygon style="${S}" points="${starPoints(50, 12, 10, 4.2)}"/><circle style="${S}" cx="42" cy="58" r="3"/><circle style="${S}" cx="60" cy="74" r="3"/><circle style="${S}" cx="36" cy="80" r="3"/><circle style="${S}" cx="56" cy="40" r="2.6"/>`,
});
// Stocking
add({
  id: 'stocking', name: 'Stocking', kind: 'ornament', tags: ['christmas'], twoTone: true,
  svg: `<path style="${P}" d="M34 22 H66 V56 L76 66 C84 74 80 92 64 92 H46 C30 92 24 78 32 68 L34 64Z"/><rect style="${S}" x="30" y="8" width="40" height="18" rx="4"/>`,
});
// Candy cane
add({
  id: 'candy-cane', name: 'Candy Cane', kind: 'ornament', tags: ['christmas'], twoTone: true,
  svg: `<path style="${SP}" stroke-width="13" stroke-linecap="round" d="M62 92 V38 C62 16 30 16 30 38"/><path style="${SS}" stroke-width="13" stroke-dasharray="7 8" d="M62 92 V38 C62 16 30 16 30 38"/>`,
});
// Wreath
add({
  id: 'wreath', name: 'Wreath', kind: 'ornament', tags: ['christmas', 'holiday', 'winter', 'thank-you'], twoTone: true,
  svg: `<circle style="${SP}" stroke-width="3" cx="50" cy="50" r="32"/>${arcLeaves(50, 50, 32, -80, 260, 22, 15, 5)}${[20, 95, 150, 215, 300].map((a) => { const [x, y] = polar(50, 50, 32, a); return `<circle style="${S}" cx="${n(x)}" cy="${n(y)}" r="3.6"/>`; }).join('')}<path style="${S}" d="M50 82 C40 72 30 76 34 86 C38 92 46 86 50 82Z M50 82 C60 72 70 76 66 86 C62 92 54 86 50 82Z"/><path style="${S}" d="M48 84 L40 98 L46 96 L50 86Z M52 84 L60 98 L54 96 L50 86Z"/>`,
});
// Menorah (hanukkiah)
add({
  id: 'menorah', name: 'Menorah', kind: 'ornament', tags: ['hanukkah'], twoTone: true,
  svg: (() => {
    let arms = '';
    for (let i = 1; i <= 4; i++) {
      const r = 9 * i;
      arms += `<path style="${SP}" stroke-width="3" d="M${50 - r} 40 A${r} ${r} 0 0 0 ${50 + r} 40"/>`;
    }
    let candles = '';
    for (let i = -4; i <= 4; i++) {
      const x = 50 + 9 * i;
      if (i === 0) {
        candles += `<rect style="${P}" x="47.6" y="20" width="4.8" height="22" rx="1"/>${flame(50, 15, 3.4)}`;
      } else {
        candles += `<rect style="${P}" x="${n(x - 2)}" y="29" width="4" height="12" rx="1"/>${flame(x, 24.5, 3)}`;
      }
    }
    return `${arms}<rect style="${P}" x="47.5" y="40" width="5" height="44"/><path style="${P}" d="M30 94 C30 86 42 84 50 84 C58 84 70 86 70 94Z"/>${candles}`;
  })(),
});
// Dreidel
add({
  id: 'dreidel', name: 'Dreidel', kind: 'ornament', tags: ['hanukkah'], twoTone: true,
  svg: `<rect style="${P}" x="45" y="6" width="10" height="20" rx="3"/><path style="${P}" d="M26 26 H74 V60 L50 94 L26 60Z"/><path style="${S}" d="M40 38 H58 V44 H54 V58 H48 V44 H40Z"/>`,
});
// Star of David
add({
  id: 'star-of-david', name: 'Star of David', kind: 'ornament', tags: ['hanukkah', 'passover', 'rosh-hashanah'],
  svg: `<g style="${SP}" stroke-width="5" stroke-linejoin="round"><polygon points="50,8 87,72 13,72"/><polygon points="50,92 13,28 87,28"/></g>`,
});
// Kinara
add({
  id: 'kinara', name: 'Kinara', kind: 'ornament', tags: ['kwanzaa'], twoTone: true,
  svg: (() => {
    let c = '';
    for (let i = 0; i < 7; i++) {
      const x = 14 + i * 12;
      const h = i === 3 ? 30 : 24;
      c += `<rect style="${i < 3 ? S : P}" x="${x - 3}" y="${62 - h}" width="6" height="${h}" rx="1"/>${flame(x, 62 - h - 5, 3, S)}`;
    }
    return `${c}<rect style="${P}" x="6" y="62" width="88" height="8" rx="2"/><path style="${P}" d="M30 70 H70 L64 90 H36Z"/>`;
  })(),
});
// Sun (solstice)
add({
  id: 'sun', name: 'Sun', kind: 'ornament', tags: ['winter-solstice', 'summer', 'july-4', 'any'], twoTone: true,
  svg: `${rotAll(12, () => `<polygon style="${S}" points="50,4 54,22 46,22"/>`)}<circle style="${P}" cx="50" cy="50" r="22"/>`,
});
// Crescent + star
add({
  id: 'crescent-star', name: 'Crescent & Star', kind: 'ornament', tags: ['eid', 'ramadan'], twoTone: true,
  svg: `<path style="${P}" d="${crescentPath(44, 52, 40, 60, 42, 34)}"/><polygon style="${S}" points="${starPoints(72, 56, 13, 5.4)}"/>`,
});
add({
  id: 'moon-stars', name: 'Moon & Stars', kind: 'ornament', tags: ['winter-solstice', 'eid', 'new-year', 'birth'], twoTone: true,
  svg: `<path style="${P}" d="${crescentPath(40, 56, 34, 54, 46, 28)}"/><polygon style="${S}" points="${starPoints(76, 22, 10, 4)}"/><polygon style="${S}" points="${starPoints(86, 56, 6, 2.5)}"/><polygon style="${S}" points="${starPoints(62, 86, 5, 2)}"/>`,
});
// Lantern (fanous)
add({
  id: 'lantern', name: 'Lantern', kind: 'ornament', tags: ['eid', 'ramadan', 'diwali'], twoTone: true,
  svg: `<circle style="${SP}" stroke-width="3" cx="50" cy="8" r="5"/><polygon style="${P}" points="44,14 56,14 66,26 34,26"/><polygon style="${P}" points="30,28 70,28 78,60 66,84 34,84 22,60"/><polygon style="${S}" points="38,34 48,34 48,76 38,76 31,60"/><polygon style="${S}" points="52,34 62,34 69,60 62,76 52,76"/><polygon style="${P}" points="40,86 60,86 54,96 46,96"/>`,
});
// Hearts
add({ id: 'heart', name: 'Heart', kind: 'ornament', tags: ['valentines', 'wedding', 'mothers-day', 'thank-you', 'birth', 'any'], svg: `<path style="${P}" d="${heartPath}"/>` });
add({ id: 'heart-outline', name: 'Outline Heart', kind: 'ornament', tags: ['valentines', 'wedding', 'any'], svg: `<path style="${SP}" stroke-width="5" stroke-linejoin="round" d="${heartPath}"/>` });
add({
  id: 'hearts', name: 'Heart Trio', kind: 'ornament', tags: ['valentines', 'wedding', 'mothers-day'], twoTone: true,
  svg: `<g transform="translate(18 26) scale(0.6)"><path style="${P}" d="${heartPath}"/></g><g transform="translate(2 8) scale(0.3) rotate(-15 50 50)"><path style="${S}" d="${heartPath}"/></g><g transform="translate(70 4) scale(0.28) rotate(18 50 50)"><path style="${S}" d="${heartPath}"/></g>`,
});
// Shamrock
add({
  id: 'shamrock', name: 'Shamrock', kind: 'ornament', tags: ['st-patricks'],
  svg: `${[-90, 30, 150].map((a) => `<g transform="rotate(${a + 90} 50 46) translate(50 46) scale(0.34) translate(-50 -88)"><path style="${P}" d="${heartPath}"/></g>`).join('')}<path style="${SP}" stroke-width="5" stroke-linecap="round" d="M50 50 Q52 76 64 94"/>`,
});
// Egg
add({
  id: 'egg', name: 'Easter Egg', kind: 'ornament', tags: ['easter', 'spring'], twoTone: true,
  svg: `<path style="${P}" d="M50 6 C72 6 86 40 86 60 C86 82 70 96 50 96 C30 96 14 82 14 60 C14 40 28 6 50 6Z"/><polyline style="${SS}" stroke-width="4" stroke-linejoin="round" points="16,56 24,48 32,56 40,48 48,56 56,48 64,56 72,48 80,56 84,52"/>${[36, 50, 64].map((x) => `<circle style="${S}" cx="${x}" cy="34" r="3.2"/>`).join('')}${[28, 42, 58, 72].map((x) => `<circle style="${S}" cx="${x}" cy="76" r="3.2"/>`).join('')}`,
});
// Bunny
add({
  id: 'bunny', name: 'Bunny', kind: 'ornament', tags: ['easter', 'spring'], twoTone: true,
  svg: `<ellipse style="${P}" cx="30" cy="22" rx="6" ry="18" transform="rotate(-12 30 22)"/><ellipse style="${P}" cx="43" cy="20" rx="6" ry="18" transform="rotate(14 43 20)"/><circle style="${P}" cx="36" cy="46" r="15"/><ellipse style="${P}" cx="58" cy="70" rx="28" ry="22"/><circle style="${S}" cx="86" cy="70" r="8"/><ellipse style="${P}" cx="42" cy="90" rx="13" ry="5"/>`,
});
// Tulip / spring flower
add({
  id: 'tulip', name: 'Tulip', kind: 'ornament', tags: ['easter', 'spring', 'mothers-day', 'thank-you'], twoTone: true,
  svg: `<path style="${SP}" stroke-width="3.5" stroke-linecap="round" d="M50 50 V96"/><path style="${S}" d="M50 80 C36 78 26 66 24 52 C38 56 48 66 50 80Z M50 86 C64 84 76 72 78 58 C64 62 52 72 50 86Z"/><path style="${P}" d="M30 14 L40 26 L50 10 L60 26 L70 14 C74 34 66 52 50 54 C34 52 26 34 30 14Z"/>`,
});
// Kiddush cup
add({
  id: 'kiddush-cup', name: 'Kiddush Cup', kind: 'ornament', tags: ['passover', 'rosh-hashanah'], twoTone: true,
  svg: `<path style="${P}" d="M28 12 H72 C72 38 63 52 54 54 V76 C54 80 66 82 68 90 H32 C34 82 46 80 46 76 V54 C37 52 28 38 28 12Z"/><rect style="${S}" x="29" y="20" width="42" height="5"/><rect style="${S}" x="32" y="88" width="36" height="4"/>`,
});
// Apple + honey (Rosh Hashanah)
add({
  id: 'apple', name: 'Apple', kind: 'ornament', tags: ['rosh-hashanah', 'autumn', 'teacher', 'thank-you'], twoTone: true,
  svg: `<path style="${P}" d="M50 32 C40 22 16 22 14 48 C12 72 32 94 50 86 C68 94 88 72 86 48 C84 22 60 22 50 32Z"/><path style="${SP}" stroke-width="3.5" stroke-linecap="round" d="M50 32 Q50 20 56 12"/><g transform="translate(55 20) rotate(-30)">${leaf(24, 8, S)}</g>`,
});
// Pomegranate
add({
  id: 'pomegranate', name: 'Pomegranate', kind: 'ornament', tags: ['rosh-hashanah', 'autumn'], twoTone: true,
  svg: `<circle style="${P}" cx="50" cy="58" r="34"/><path style="${S}" d="M38 26 L42 12 L46 22 L50 8 L54 22 L58 12 L62 26Z"/>`,
});
// Diya
add({
  id: 'diya', name: 'Diya Lamp', kind: 'ornament', tags: ['diwali'], twoTone: true,
  svg: `${flame(52, 36, 11)}<path style="${P}" d="M8 54 C14 54 22 56 30 58 C40 60 60 60 70 58 C80 56 88 52 94 48 C92 66 76 84 50 84 C26 84 10 70 8 54Z"/>${[30, 42, 54, 66].map((x) => `<circle style="${S}" cx="${x}" cy="70" r="2.6"/>`).join('')}`,
});
// Rangoli
add({
  id: 'rangoli', name: 'Rangoli', kind: 'ornament', tags: ['diwali', 'any'], twoTone: true,
  svg: `${rotAll(8, () => `<g transform="translate(50 50) rotate(-90)"><g transform="translate(12 0)">${leaf(34, 9)}</g></g>`)}${rotAll(8, () => `<g transform="translate(50 50) rotate(-90)"><g transform="translate(10 0)">${leaf(20, 5, S)}</g></g>`, 50, 50, 22.5)}${rotAll(16, () => `<circle style="${S}" cx="50" cy="3" r="2.2"/>`)}<circle style="${S}" cx="50" cy="50" r="8"/><circle style="${P}" cx="50" cy="50" r="4"/>`,
});
// Pumpkin
add({
  id: 'pumpkin', name: 'Pumpkin', kind: 'ornament', tags: ['halloween', 'thanksgiving', 'autumn'], twoTone: true,
  svg: `<ellipse style="${P}" cx="28" cy="60" rx="20" ry="28"/><ellipse style="${P}" cx="72" cy="60" rx="20" ry="28"/><ellipse style="${P}" cx="40" cy="60" rx="20" ry="31"/><ellipse style="${P}" cx="60" cy="60" rx="20" ry="31"/><ellipse style="${P}" cx="50" cy="60" rx="16" ry="32"/><path style="${SS}" stroke-width="2" d="M40 32 Q30 60 40 90 M60 32 Q70 60 60 90 M28 34 Q14 60 28 86 M72 34 Q86 60 72 86"/><path style="${S}" d="M46 30 L48 12 Q52 8 56 12 L54 30Z"/><g transform="translate(56 16) rotate(-20)">${leaf(22, 7, S)}</g>`,
});
// Bat
add({
  id: 'bat', name: 'Bat', kind: 'ornament', tags: ['halloween'],
  svg: `<path style="${P}" d="M50 40 L46 32 L44 40 C36 36 26 30 10 34 C18 40 18 48 14 54 C22 50 28 54 30 60 C34 54 40 56 44 62 L50 66 L56 62 C60 56 66 54 70 60 C72 54 78 50 86 54 C82 48 82 40 90 34 C74 30 64 36 56 40 L54 32Z"/>`,
});
// Maple leaf
add({
  id: 'maple-leaf', name: 'Maple Leaf', kind: 'ornament', tags: ['thanksgiving', 'autumn'],
  svg: `<polygon style="${P}" points="50,4 56,16 63,13 60,34 71,22 73,28 84,26 80,38 88,42 70,56 73,64 54,62 55,82 51,82 51,96 49,96 49,82 45,82 46,62 27,64 30,56 12,42 20,38 16,26 27,28 29,22 40,34 37,13 44,16"/>`,
});
// Wheat
add({
  id: 'wheat', name: 'Wheat', kind: 'ornament', tags: ['thanksgiving', 'autumn'],
  svg: `<path style="${SP}" stroke-width="3" stroke-linecap="round" d="M50 96 V20"/>${[0, 1, 2, 3, 4].map((i) => { const y = 24 + i * 11; return `<ellipse style="${P}" cx="42" cy="${y}" rx="4.5" ry="9" transform="rotate(-32 42 ${y})"/><ellipse style="${P}" cx="58" cy="${y}" rx="4.5" ry="9" transform="rotate(32 58 ${y})"/>`; }).join('')}<ellipse style="${P}" cx="50" cy="12" rx="4.5" ry="9"/>`,
});
// Firework
add({
  id: 'firework', name: 'Firework', kind: 'ornament', tags: ['new-year', 'july-4', 'birthday', 'graduation'], twoTone: true,
  svg: `<g style="${SP}" stroke-width="2.6" stroke-linecap="round">${rotAll(16, () => `<path d="M50 38 V8"/>`)}</g>${rotAll(16, () => `<circle style="${P}" cx="50" cy="4" r="2.6"/>`)}<g style="${SS}" stroke-width="2.4" stroke-linecap="round">${rotAll(8, () => `<path d="M50 42 V28"/>`, 50, 50, 11.25)}</g>`,
});
// Champagne
add({
  id: 'champagne', name: 'Champagne Toast', kind: 'ornament', tags: ['new-year', 'wedding', 'birthday', 'graduation'], twoTone: true,
  svg: `<g transform="rotate(-14 34 60)"><path style="${P}" d="M24 16 H44 L42 46 C41 52 37 54 35 54 V82 H42 V86 H26 V82 H33 V54 C31 54 27 52 26 46Z"/></g><g transform="rotate(14 66 60)"><path style="${P}" d="M56 16 H76 L74 46 C73 52 69 54 67 54 V82 H74 V86 H58 V82 H65 V54 C63 54 59 52 58 46Z"/></g><circle style="${S}" cx="50" cy="10" r="3"/><circle style="${S}" cx="44" cy="4" r="2"/><circle style="${S}" cx="57" cy="5" r="2"/>`,
});
// Graduation cap
add({
  id: 'grad-cap', name: 'Graduation Cap', kind: 'ornament', tags: ['graduation'], twoTone: true,
  svg: `<polygon style="${P}" points="50,20 94,38 50,56 6,38"/><path style="${P}" d="M24 46 V66 C24 76 76 76 76 66 V46 L50 57Z"/><path style="${SS}" stroke-width="2.4" d="M50 38 L82 46 V70"/><rect style="${S}" x="78" y="68" width="8" height="14" rx="2"/>`,
});
// Rattle
add({
  id: 'rattle', name: 'Baby Rattle', kind: 'ornament', tags: ['birth', 'first-birthday'], twoTone: true,
  svg: `<circle style="${P}" cx="36" cy="36" r="26"/><path style="${SS}" stroke-width="4" d="M16 26 Q36 34 56 26 M14 42 Q36 50 58 42"/><path style="${SP}" stroke-width="9" stroke-linecap="round" d="M54 54 L80 80"/><circle style="${SS}" stroke-width="5" cx="86" cy="86" r="8"/>`,
});
// Onesie
add({
  id: 'onesie', name: 'Onesie', kind: 'ornament', tags: ['birth'], twoTone: true,
  svg: `<path style="${P}" d="M34 10 C40 18 60 18 66 10 L88 22 L80 38 L70 34 V78 C70 86 62 92 56 92 H44 C38 92 30 86 30 78 V34 L20 38 L12 22Z"/>${[40, 50, 60].map((x) => `<circle style="${S}" cx="${x}" cy="86" r="2.4"/>`).join('')}<path style="${S}" d="${heartPath}" transform="translate(41 42) scale(0.18)"/>`,
});
// Balloon
add({
  id: 'balloon', name: 'Balloon', kind: 'ornament', tags: ['birthday', 'first-birthday', 'graduation', 'birth'], twoTone: true,
  svg: `<ellipse style="${P}" cx="50" cy="38" rx="28" ry="34"/><polygon style="${P}" points="46,72 54,72 50,78"/><path style="${SS}" stroke-width="2" d="M50 78 C42 86 58 90 50 99"/><ellipse style="fill:#ffffff;opacity:.3" cx="39" cy="26" rx="6" ry="10" transform="rotate(30 39 26)"/>`,
});
// Cake
add({
  id: 'cake', name: 'Birthday Cake', kind: 'ornament', tags: ['first-birthday', 'birthday'], twoTone: true,
  svg: `${flame(50, 12, 4.2)}<rect style="${S}" x="47.5" y="16" width="5" height="18" rx="1"/><rect style="${P}" x="28" y="34" width="44" height="24" rx="3"/><rect style="${P}" x="16" y="56" width="68" height="30" rx="3"/><path style="${S}" d="M28 36 H72 V42 C68 48 64 40 60 44 C56 48 52 40 48 44 C44 48 40 40 36 44 C32 48 30 42 28 44Z M16 58 H84 V64 C80 70 76 62 72 66 C68 70 64 62 60 66 C56 70 52 62 48 66 C44 70 40 62 36 66 C32 70 28 62 24 66 C20 70 18 64 16 66Z"/><rect style="${P}" x="8" y="86" width="84" height="5" rx="2"/>`,
});
// House
add({
  id: 'house', name: 'Home', kind: 'ornament', tags: ['new-home', 'christmas', 'thank-you'], twoTone: true,
  svg: `<rect style="${P}" x="66" y="18" width="9" height="22"/><polygon style="${P}" points="50,12 92,48 84,48 84,92 16,92 16,48 8,48"/><rect style="${S}" x="43" y="62" width="14" height="30" rx="1"/><rect style="${S}" x="24" y="56" width="12" height="12"/><rect style="${S}" x="64" y="56" width="12" height="12"/>`,
});
// Key
add({
  id: 'key', name: 'Key', kind: 'ornament', tags: ['new-home'], twoTone: true,
  svg: `<circle style="${SP}" stroke-width="8" cx="24" cy="50" r="15"/><rect style="${P}" x="37" y="46" width="56" height="8" rx="2"/><rect style="${P}" x="74" y="52" width="6" height="14"/><rect style="${P}" x="84" y="52" width="6" height="10"/><circle style="${S}" cx="24" cy="50" r="5"/>`,
});
// Rings
add({
  id: 'rings', name: 'Wedding Rings', kind: 'ornament', tags: ['wedding'], twoTone: true,
  svg: `<circle style="${SP}" stroke-width="5" cx="38" cy="60" r="22"/><circle style="${SP}" stroke-width="5" cx="62" cy="60" r="22"/><polygon style="${S}" points="38,24 46,32 38,40 30,32"/>`,
});
// Envelope
add({
  id: 'envelope', name: 'Envelope', kind: 'ornament', tags: ['thank-you', 'save-the-date', 'any'], twoTone: true,
  svg: `<rect style="${SP}" stroke-width="4" stroke-linejoin="round" x="8" y="22" width="84" height="58" rx="3"/><polyline style="${SP}" stroke-width="4" stroke-linejoin="round" points="8,24 50,58 92,24"/><path style="${S}" d="${heartPath}" transform="translate(41 50) scale(0.18)"/>`,
});
// Gift
add({
  id: 'gift', name: 'Gift', kind: 'ornament', tags: ['christmas', 'birthday', 'thank-you', 'holiday'], twoTone: true,
  svg: `<rect style="${P}" x="16" y="44" width="68" height="48" rx="2"/><rect style="${P}" x="12" y="32" width="76" height="14" rx="2"/><rect style="${S}" x="45" y="32" width="10" height="60"/><path style="${S}" d="M50 32 C38 14 22 18 30 30Z M50 32 C62 14 78 18 70 30Z"/>`,
});
// Laurel
add({
  id: 'laurel', name: 'Laurel Wreath', kind: 'ornament', tags: ['graduation', 'wedding', 'any', 'monogram'],
  svg: `<path style="${SP}" stroke-width="2" d="M44 92 A42 42 0 0 1 22 22"/><path style="${SP}" stroke-width="2" d="M56 92 A42 42 0 0 0 78 22"/>${arcLeaves(50, 50, 42, 100, 222, 9, 14, 4.6)}<g transform="translate(100 0) scale(-1 1)">${arcLeaves(50, 50, 42, 100, 222, 9, 14, 4.6)}</g>`,
});
// Olive branch
add({
  id: 'olive-branch', name: 'Olive Branch', kind: 'ornament', tags: ['holiday', 'thank-you', 'passover', 'any'], twoTone: true,
  svg: `<path style="${SP}" stroke-width="2.6" stroke-linecap="round" d="M8 86 Q46 56 92 16"/>${[0.15, 0.3, 0.45, 0.6, 0.75, 0.88].map((t, i) => { const [x, y] = quadPoint([8, 86], [46, 56], [92, 16], t); const ang = i % 2 ? -75 : 25; return `<g transform="translate(${n(x)} ${n(y)}) rotate(${ang - 40})">${leaf(18, 5)}</g>`; }).join('')}<ellipse style="${S}" cx="40" cy="70" rx="4" ry="5.5"/><ellipse style="${S}" cx="66" cy="44" rx="4" ry="5.5"/>`,
});
// Plum blossom
add({
  id: 'plum-blossom', name: 'Plum Blossom', kind: 'ornament', tags: ['lunar-new-year', 'spring'], twoTone: true,
  svg: `${rotAll(5, () => `<circle style="${P}" cx="50" cy="30" r="17"/>`)}<circle style="${S}" cx="50" cy="50" r="10"/><g style="${SS}" stroke-width="1.6" stroke-linecap="round">${rotAll(10, () => `<path d="M50 50 V36"/>`)}</g>`,
});
// Lunar lantern
add({
  id: 'lunar-lantern', name: 'Paper Lantern', kind: 'ornament', tags: ['lunar-new-year', 'diwali'], twoTone: true,
  svg: `<path style="${SP}" stroke-width="2" d="M50 2 V16"/><rect style="${S}" x="38" y="16" width="24" height="7" rx="2"/><ellipse style="${P}" cx="50" cy="50" rx="32" ry="28"/><g style="${SS}" stroke-width="2"><ellipse cx="50" cy="50" rx="20" ry="28"/><ellipse cx="50" cy="50" rx="8" ry="28"/></g><rect style="${S}" x="38" y="77" width="24" height="7" rx="2"/><path style="${SS}" stroke-width="2" d="M44 84 V98 M50 84 V99 M56 84 V98"/>`,
});
// Bunting
add({
  id: 'bunting', name: 'Bunting', kind: 'divider', tags: ['july-4', 'birthday', 'first-birthday', 'graduation', 'new-home'], twoTone: true, vb: '0 0 200 60',
  svg: (() => {
    let flags = '';
    for (let i = 0; i < 8; i++) {
      const t0 = (i + 0.08) / 8, t1 = (i + 0.92) / 8;
      const [x0, y0] = quadPoint([4, 8], [100, 34], [196, 8], t0);
      const [x1, y1] = quadPoint([4, 8], [100, 34], [196, 8], t1);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      flags += `<polygon style="${i % 2 ? S : P}" points="${n(x0)},${n(y0)} ${n(x1)},${n(y1)} ${n(mx)},${n(my + 26)}"/>`;
    }
    return `<path style="${SP}" stroke-width="1.6" d="M4 8 Q100 34 196 8"/>${flags}`;
  })(),
});
// Necktie
add({
  id: 'necktie', name: 'Necktie', kind: 'ornament', tags: ['fathers-day', 'graduation'], twoTone: true,
  svg: `<polygon style="${P}" points="42,6 58,6 60,20 40,20"/><polygon style="${P}" points="40,20 60,20 68,76 50,96 32,76"/><path style="${SS}" stroke-width="3" d="M42 34 L58 28 M40 50 L62 42 M38 66 L64 56"/>`,
});
// Confetti scatter
add({
  id: 'confetti', name: 'Confetti', kind: 'scatter', tags: ['new-year', 'birthday', 'first-birthday', 'graduation', 'july-4', 'any'], twoTone: true,
  svg: (() => {
    const r = prng(42);
    let s = '';
    for (let i = 0; i < 46; i++) {
      const x = 4 + r() * 92, y = 4 + r() * 92, a = r() * 360, kind = Math.floor(r() * 3), st = i % 2 ? S : P;
      if (kind === 0) s += `<rect style="${st}" x="${n(x - 2.5)}" y="${n(y - 1.2)}" width="5" height="2.4" transform="rotate(${n(a)} ${n(x)} ${n(y)})"/>`;
      else if (kind === 1) s += `<circle style="${st}" cx="${n(x)}" cy="${n(y)}" r="${n(1 + r() * 1.4)}"/>`;
      else s += `<polygon style="${st}" points="${n(x)},${n(y - 2.4)} ${n(x + 2.2)},${n(y + 1.6)} ${n(x - 2.2)},${n(y + 1.6)}" transform="rotate(${n(a)} ${n(x)} ${n(y)})"/>`;
    }
    return s;
  })(),
});
// Snow scatter
add({
  id: 'snowfall', name: 'Snowfall', kind: 'scatter', tags: ['winter', 'christmas', 'holiday', 'solstice', 'hanukkah'],
  svg: (() => {
    const r = prng(9);
    let s = '';
    for (let i = 0; i < 70; i++) s += `<circle style="${P}" cx="${n(r() * 100)}" cy="${n(r() * 100)}" r="${n(0.5 + r() * 1.6)}" opacity="${n(0.5 + r() * 0.5)}"/>`;
    return s;
  })(),
});
// Dividers
add({
  id: 'flourish', name: 'Flourish Divider', kind: 'divider', tags: ['any', 'wedding', 'christmas', 'thank-you'], vb: '0 0 200 40',
  svg: (() => {
    const half = `<path d="M108 20 C126 20 136 8 152 10 C164 12 166 26 154 27 C146 28 144 18 152 17"/><path d="M118 21 C140 26 162 30 196 20" stroke-width="1.4"/>`;
    return `<g style="${SP}" stroke-width="2.2" stroke-linecap="round">${half}<g transform="translate(200 0) scale(-1 1)">${half}</g></g><polygon style="${P}" points="100,12 106,20 100,28 94,20"/>`;
  })(),
});
add({
  id: 'divider-diamond', name: 'Diamond Rule', kind: 'divider', tags: ['any'], vb: '0 0 200 20',
  svg: `<path style="${SP}" stroke-width="1.4" d="M4 10 H86 M114 10 H196"/><polygon style="${P}" points="100,3 107,10 100,17 93,10"/><circle style="${P}" cx="88" cy="10" r="1.8"/><circle style="${P}" cx="112" cy="10" r="1.8"/>`,
});
add({
  id: 'divider-stars', name: 'Star Rule', kind: 'divider', tags: ['christmas', 'july-4', 'new-year', 'holiday'], vb: '0 0 200 20', twoTone: true,
  svg: `<path style="${SP}" stroke-width="1.2" d="M4 10 H76 M124 10 H196"/><polygon style="${P}" points="${starPoints(100, 10.5, 8, 3.4)}"/><polygon style="${S}" points="${starPoints(84, 10.5, 4.5, 1.9)}"/><polygon style="${S}" points="${starPoints(116, 10.5, 4.5, 1.9)}"/>`,
});
add({
  id: 'corner-flourish', name: 'Corner Flourish', kind: 'corner', tags: ['any', 'wedding', 'christmas'],
  svg: `<g style="${SP}" stroke-width="2" stroke-linecap="round"><path d="M6 94 V30 C6 14 14 6 30 6 H94"/><path d="M6 46 C20 46 28 34 24 24 C20 16 10 18 12 26"/><path d="M46 6 C46 20 34 28 24 24"/><path d="M14 94 V36 C14 22 22 14 36 14 H94" stroke-width="0.9"/></g><circle style="${P}" cx="24" cy="24" r="3"/>`,
});
add({
  id: 'frame-double', name: 'Double Frame', kind: 'frame', tags: ['any', 'monogram'], stretch: true,
  svg: `<rect style="${SP}" vector-effect="non-scaling-stroke" stroke-width="2.5" x="2" y="2" width="96" height="96"/><rect style="${SP}" vector-effect="non-scaling-stroke" stroke-width="1" x="5" y="5" width="90" height="90"/>`,
});
add({
  id: 'frame-deco', name: 'Art Deco Frame', kind: 'frame', tags: ['new-year', 'wedding', 'any'], stretch: true,
  svg: `<path style="${SP}" vector-effect="non-scaling-stroke" stroke-width="1.6" d="M2 10 V2 H10 M90 2 H98 V10 M98 90 V98 H90 M10 98 H2 V90 M14 2 H86 M14 98 H86 M2 14 V86 M98 14 V86"/><path style="${SP}" vector-effect="non-scaling-stroke" stroke-width="0.9" d="M5 5 H95 V95 H5Z M2 10 H10 V2 M90 2 V10 H98 M98 90 H90 V98 M10 98 V90 H2"/>`,
});
add({
  id: 'frame-scallop', name: 'Scalloped Border', kind: 'frame', tags: ['any', 'birth', 'easter', 'valentines'], stretch: true,
  svg: (() => {
    let d = 'M2 2';
    const bumps = 12;
    for (let i = 0; i < bumps; i++) d += ` Q${n(2 + (96 / bumps) * (i + 0.5))} -1 ${n(2 + (96 / bumps) * (i + 1))} 2`;
    for (let i = 0; i < bumps; i++) d += ` Q101 ${n(2 + (96 / bumps) * (i + 0.5))} 98 ${n(2 + (96 / bumps) * (i + 1))}`;
    for (let i = 0; i < bumps; i++) d += ` Q${n(98 - (96 / bumps) * (i + 0.5))} 101 ${n(98 - (96 / bumps) * (i + 1))} 98`;
    for (let i = 0; i < bumps; i++) d += ` Q-1 ${n(98 - (96 / bumps) * (i + 0.5))} 2 ${n(98 - (96 / bumps) * (i + 1))}`;
    return `<path style="${SP}" vector-effect="non-scaling-stroke" stroke-width="1.6" d="${d}Z"/>`;
  })(),
});

export const BUILTIN_ORNAMENTS: OrnamentDef[] = defs.map((d) => {
  const vb = d.vb ?? '0 0 100 100';
  const [, , w, h] = vb.split(' ').map(Number);
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    tags: d.tags,
    stretch: d.stretch,
    aspect: w / h,
    twoTone: !!d.twoTone,
    svg: svg(d.svg, vb, !!d.stretch),
  };
});

const BY_ID = new Map(BUILTIN_ORNAMENTS.map((o) => [o.id, o]));

export function getBuiltinOrnament(id: string): OrnamentDef | undefined {
  return BY_ID.get(id);
}

export function ornamentsForOccasion(occasionId: string): OrnamentDef[] {
  const tagged = BUILTIN_ORNAMENTS.filter((o) => o.tags.includes(occasionId));
  return tagged.length ? tagged : BUILTIN_ORNAMENTS.filter((o) => o.tags.includes('any'));
}
