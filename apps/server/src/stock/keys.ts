import type { StockKeyStatus } from '@homecard/shared';
import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { open, seal } from '../security/keys';
import { httpError } from '../util/fsx';

/**
 * API keys for the stock providers that need one (Pixabay, Unsplash), and the Openverse switch.
 *  - An environment variable (PIXABAY_API_KEY / UNSPLASH_API_KEY / OPENVERSE_ENABLED) always
 *    wins and can't be changed in the app.
 *  - Otherwise an admin saves the key in Settings → Server. It is stored AES-256-GCM encrypted
 *    (key derived from APP_ENCRYPTION_KEY, provider name as additional authenticated data) in
 *    the settings table, and never sent back to a browser: only the last 4 characters.
 */

export type KeyedProvider = 'pixabay' | 'unsplash';
export const KEYED_PROVIDERS: KeyedProvider[] = ['pixabay', 'unsplash'];
export const STOCK_KEY_ENV: Record<KeyedProvider, string> = { pixabay: 'PIXABAY_API_KEY', unsplash: 'UNSPLASH_API_KEY' };

const settingName = (p: KeyedProvider) => `stock_key_${p}`;
const aad = (p: KeyedProvider) => `stock-key:${p}`;
const envKey = (p: KeyedProvider) => (p === 'pixabay' ? config.stock.pixabayKey : config.stock.unsplashKey);

interface StoredKey {
  iv: string;
  ciphertext: string;
  tag: string;
  last4: string;
}

/** Decrypted admin-saved keys (null = saved but unreadable). Settings only change through setStockKey. */
const cache = new Map<KeyedProvider, string | null>();

function stored(p: KeyedProvider): StoredKey | null {
  const raw = getSetting(settingName(p));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredKey;
  } catch {
    return null;
  }
}

function savedKey(p: KeyedProvider): string | null {
  if (cache.has(p)) return cache.get(p)!;
  const s = stored(p);
  let key: string | null = '';
  if (s) {
    try {
      key = open({ iv: Buffer.from(s.iv, 'base64'), ciphertext: Buffer.from(s.ciphertext, 'base64'), tag: Buffer.from(s.tag, 'base64') }, aad(p));
    } catch {
      key = null; // APP_ENCRYPTION_KEY changed since it was saved
    }
  }
  cache.set(p, key);
  return key;
}

/** The key to use for requests ('' when the provider isn't configured). Server-side only. */
export function stockKey(p: KeyedProvider): string {
  return envKey(p) || savedKey(p) || '';
}

export function stockKeyStatus(p: KeyedProvider): StockKeyStatus {
  const env = envKey(p);
  if (env) return { source: 'env', last4: env.slice(-4), unreadable: false };
  const s = stored(p);
  if (!s) return { source: 'none', last4: null, unreadable: false };
  return { source: 'admin', last4: s.last4, unreadable: savedKey(p) === null };
}

export function normalizeStockKey(input: unknown): string {
  const key = String(input ?? '').trim();
  if (!/^[\x21-\x7e]{10,200}$/.test(key)) throw httpError(400, 'That doesn’t look like an API key. Copy the whole key, without spaces.');
  return key;
}

/** Save (or with '' remove) the admin key. Refused while an environment variable sets it. */
export function setStockKey(p: KeyedProvider, key: string) {
  if (envKey(p)) throw httpError(409, `The ${p === 'pixabay' ? 'Pixabay' : 'Unsplash'} key is set by ${STOCK_KEY_ENV[p]} in the container settings. Change it there.`);
  if (!key) {
    setSetting(settingName(p), null);
    cache.set(p, '');
    return;
  }
  const s = seal(key, aad(p));
  const value: StoredKey = { iv: s.iv.toString('base64'), ciphertext: s.ciphertext.toString('base64'), tag: s.tag.toString('base64'), last4: key.slice(-4) };
  setSetting(settingName(p), JSON.stringify(value));
  cache.set(p, key);
}

/* ---------- Openverse (keyless) ---------- */

export function openverseEnabled(): boolean {
  if (config.stock.openverseFromEnv) return config.stock.openverse;
  const s = getSetting('stock_openverse');
  return s === undefined ? config.stock.openverse : s === '1';
}

export function setOpenverseEnabled(on: boolean) {
  if (config.stock.openverseFromEnv) throw httpError(409, 'Openverse is switched by OPENVERSE_ENABLED in the container settings. Change it there.');
  setSetting('stock_openverse', on ? '1' : '0');
}

/** Test hook: forget decrypted keys (e.g. after the encryption key changes). */
export function _resetStockKeyCache() {
  cache.clear();
}
