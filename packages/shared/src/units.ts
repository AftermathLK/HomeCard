/** CSS reference: 1in = 96 CSS px, 1pt = 1/72 in. */
export const CSS_PX_PER_IN = 96;
export const PT_PER_IN = 72;
export const PRINT_DPI = 300;

export const inToPx = (inches: number, dpi = CSS_PX_PER_IN) => inches * dpi;
export const pxToIn = (px: number, dpi = CSS_PX_PER_IN) => px / dpi;
export const ptToIn = (pt: number) => pt / PT_PER_IN;
export const inToPt = (inches: number) => inches * PT_PER_IN;

/** Device pixels for a physical length at a DPI (rounded to the nearest pixel). */
export const devicePx = (inches: number, dpi = PRINT_DPI) => Math.round(inches * dpi);

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/* ---------- Inches or millimetres ---------- */

/** How lengths are shown and typed. Everything is stored in inches. */
export type LengthUnit = 'in' | 'mm';
export const MM_PER_IN = 25.4;

/** A length in inches, in the given unit. */
export const toUnit = (inches: number, unit: LengthUnit) => (unit === 'mm' ? inches * MM_PER_IN : inches);
/** A length typed in the given unit, in inches. */
export const fromUnit = (v: number, unit: LengthUnit) => (unit === 'mm' ? v / MM_PER_IN : v);

const num = (v: number, decimals: number) => String(round(v, decimals));

/** A length for people to read: 0.125 → `0.125"` or `3.2 mm`. */
export function formatLength(inches: number, unit: LengthUnit, decimals = unit === 'mm' ? 1 : 3): string {
  return unit === 'mm' ? `${num(inches * MM_PER_IN, decimals)} mm` : `${num(inches, decimals)}"`;
}

/** Width × height for people to read: `5 × 7"` or `127 × 177.8 mm`. */
export function formatDims(widthIn: number, heightIn: number, unit: LengthUnit, decimals = unit === 'mm' ? 1 : 2): string {
  const w = num(toUnit(widthIn, unit), decimals);
  const h = num(toUnit(heightIn, unit), decimals);
  return unit === 'mm' ? `${w} × ${h} mm` : `${w} × ${h}"`;
}

/** Formats inches as a friendly fraction-ish string (e.g. 0.125 → 1/8"). */
export function formatInches(v: number): string {
  const fractions: Array<[number, string]> = [
    [0.0625, '1/16'],
    [0.105, '0.105'],
    [0.125, '1/8'],
    [0.1875, '3/16'],
    [0.25, '1/4'],
    [0.375, '3/8'],
    [0.5, '1/2'],
    [0.75, '3/4'],
  ];
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  if (frac < 1e-6) return `${whole}"`;
  const match = fractions.find(([f]) => Math.abs(f - frac) < 1e-4);
  if (match) return whole ? `${whole} ${match[1]}"` : `${match[1]}"`;
  return `${round(v, 3)}"`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Stable short hash (FNV-1a 32-bit, hex) usable in browser and node. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function uid(prefix = ''): string {
  const g: any = globalThis as any;
  const raw: string =
    g.crypto && typeof g.crypto.randomUUID === 'function'
      ? g.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
  return prefix ? `${prefix}_${raw.replace(/-/g, '').slice(0, 12)}` : raw;
}

/** Base64url encode/decode for small JSON payloads in URLs (browser + node). */
export function toBase64Url(json: unknown): string {
  const str = JSON.stringify(json);
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : (globalThis as any).Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url<T = unknown>(s: string): T {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = typeof atob === 'function' ? atob(b64) : (globalThis as any).Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
