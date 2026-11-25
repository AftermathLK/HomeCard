import type { UserPrefs } from './api';
import { CARD_SIZES, clampSize, MAX_SAVED_SIZES, SAVED_SIZE_ID_RE, SAVED_SIZE_PREFIX, VENDOR_PRESETS, type SavedCardSize } from './formats';

const BUILTIN_SIZES = new Set(CARD_SIZES.filter((s) => s.id !== 'custom').map((s) => s.id));
const MAX_FAVORITE_SIZES = 40;
const MAX_SIZE_NAME = 40;

/**
 * Account preferences from a client: only valid fields come back, and fields that are missing or
 * invalid are left out, so the server can merge the result over what it already has.
 */
export function sanitizeUserPrefs(input: unknown): UserPrefs {
  const out: UserPrefs = {};
  if (!input || typeof input !== 'object') return out;
  const p = input as Record<string, unknown>;
  if (typeof p.defaultVendorId === 'string' && VENDOR_PRESETS.some((v) => v.id === p.defaultVendorId)) out.defaultVendorId = p.defaultVendorId;
  if (p.units === 'in' || p.units === 'mm') out.units = p.units;
  if (Array.isArray(p.savedSizes)) {
    const seen = new Set<string>();
    const list: SavedCardSize[] = [];
    for (const raw of p.savedSizes) {
      const s = savedSize(raw);
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      list.push(s);
      if (list.length >= MAX_SAVED_SIZES) break;
    }
    out.savedSizes = list;
  }
  if (Array.isArray(p.favoriteSizes)) {
    const ok = (id: unknown): id is string =>
      typeof id === 'string' && (BUILTIN_SIZES.has(id) || (id.startsWith(SAVED_SIZE_PREFIX) && SAVED_SIZE_ID_RE.test(id.slice(SAVED_SIZE_PREFIX.length))));
    out.favoriteSizes = [...new Set(p.favoriteSizes.filter(ok))].slice(0, MAX_FAVORITE_SIZES);
  }
  return out;
}

function savedSize(raw: unknown): SavedCardSize | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, name, w, h } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !SAVED_SIZE_ID_RE.test(id)) return null;
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const label = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_SIZE_NAME).trim() : '';
  if (!label) return null;
  const [a, b] = [clampSize(w), clampSize(h)];
  return { id, name: label, w: Math.min(a, b), h: Math.max(a, b) };
}
