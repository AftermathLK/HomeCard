import type { StockItem, StockProviderId, StockProviderInfo, StockSearchQuery } from '@homecard/shared';
import { HttpError } from '../util/fsx';
import { openverseEnabled, stockKey, type KeyedProvider } from './keys';
import { servedSize } from './served-size';
import { safeGet, safeGetJson, type SafeGetOptions } from './net';

/**
 * Stock background providers. All calls are made by the server (API keys never reach the
 * browser) and results are cached for 24 hours (Pixabay's terms require it; it also keeps us
 * well inside every provider's rate limits).
 */

export interface ProviderItem {
  item: StockItem;
  /** Full-size file HomeCard downloads for printing. */
  downloadUrl: string;
  /** Hosts the download may come from. */
  downloadHosts: SafeGetOptions['hosts'];
  allowHttp?: boolean;
  /** Pixabay/Openverse: thumbnail fetched by the server (proxied); Unsplash: hotlinked. */
  thumbSource?: string;
  thumbHosts?: SafeGetOptions['hosts'];
  /** Unsplash: must be called whenever someone uses the photo. */
  trackUrl?: string;
}

export interface ProviderPage {
  items: ProviderItem[];
  hasMore: boolean;
  total?: number;
}

const PER_PAGE = 30;
const UNSPLASH_UTM = 'utm_source=homecard&utm_medium=referral';
const withUtm = (u: string) => (u ? `${u}${u.includes('?') ? '&' : '?'}${UNSPLASH_UTM}` : u);

export const PIXABAY_COLORS = ['grayscale', 'transparent', 'red', 'orange', 'yellow', 'green', 'turquoise', 'blue', 'lilac', 'pink', 'white', 'gray', 'black', 'brown'];
export const UNSPLASH_COLORS = ['black_and_white', 'black', 'white', 'yellow', 'orange', 'red', 'purple', 'magenta', 'green', 'teal', 'blue'];

export function providerInfo(): StockProviderInfo[] {
  return [
    { id: 'pixabay', name: 'Pixabay', enabled: !!stockKey('pixabay'), keyless: false, license: 'Pixabay Content License — free to use, no attribution required.' },
    { id: 'unsplash', name: 'Unsplash', enabled: !!stockKey('unsplash'), keyless: false, license: 'Unsplash License — free to use; photographer credit shown.' },
    { id: 'openverse', name: 'Openverse', enabled: openverseEnabled(), keyless: true, license: 'Public domain / CC0 only — free to use without permission.' },
  ];
}

export function providerEnabled(id: StockProviderId) {
  return providerInfo().find((p) => p.id === id)?.enabled ?? false;
}

/* ---------------- Pixabay ---------------- */

const PIXABAY_HOSTS = ['pixabay.com'];

function pixabayItem(h: any): ProviderItem {
  const w = Number(h.imageWidth) || Number(h.webformatWidth) || 0;
  const hgt = Number(h.imageHeight) || Number(h.webformatHeight) || 0;
  // Standard API access returns up to 1280 px (largeImageURL); full API access adds the original.
  const full = h.imageURL || h.fullHDURL || h.largeImageURL || h.webformatURL;
  const fullLong = h.imageURL ? Math.max(w, hgt) : h.fullHDURL ? 1920 : 1280;
  const k = Math.min(1, fullLong / Math.max(1, w, hgt));
  return {
    item: {
      provider: 'pixabay',
      id: String(h.id),
      thumbUrl: `/api/stock/thumb/pixabay/${encodeURIComponent(String(h.id))}`,
      width: w,
      height: hgt,
      printWidth: Math.round(w * k),
      printHeight: Math.round(hgt * k),
      title: String(h.tags ?? '').split(',').slice(0, 3).join(', ').trim() || 'Pixabay image',
      attribution: {
        text: `Image by ${h.user ?? 'a Pixabay contributor'} from Pixabay`,
        author: h.user ?? undefined,
        authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${Number(h.user_id)}/` : undefined,
        sourceUrl: h.pageURL ?? undefined,
        license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
      },
    },
    downloadUrl: String(full ?? ''),
    downloadHosts: PIXABAY_HOSTS,
    thumbSource: String(h.webformatURL || h.previewURL || ''),
    thumbHosts: PIXABAY_HOSTS,
  };
}

async function pixabaySearch(q: StockSearchQuery): Promise<ProviderPage> {
  const p = new URLSearchParams({ key: stockKey('pixabay'), q: q.q.slice(0, 100), per_page: String(PER_PAGE), page: String(q.page ?? 1), safesearch: 'true' });
  if (q.imageType && q.imageType !== 'all') p.set('image_type', q.imageType);
  if (q.orientation === 'horizontal' || q.orientation === 'vertical') p.set('orientation', q.orientation);
  if (q.color && PIXABAY_COLORS.includes(q.color)) p.set('colors', q.color);
  const r = await safeGetJson<{ totalHits: number; hits: any[] }>(`https://pixabay.com/api/?${p}`, { hosts: PIXABAY_HOSTS });
  const items = (r.hits ?? []).map(pixabayItem);
  return { items, total: r.totalHits, hasMore: (q.page ?? 1) * PER_PAGE < Math.min(500, r.totalHits ?? 0) };
}

async function pixabayGet(id: string): Promise<ProviderItem | null> {
  const p = new URLSearchParams({ key: stockKey('pixabay'), id });
  const r = await safeGetJson<{ hits: any[] }>(`https://pixabay.com/api/?${p}`, { hosts: PIXABAY_HOSTS });
  return r.hits?.[0] ? pixabayItem(r.hits[0]) : null;
}

/* ---------------- Unsplash ---------------- */

const UNSPLASH_API = ['api.unsplash.com'];
const UNSPLASH_IMAGES = ['images.unsplash.com'];
const unsplashHeaders = (key = stockKey('unsplash')) => ({ Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' });

function unsplashItem(ph: any): ProviderItem {
  const w = Number(ph.width) || 0;
  const h = Number(ph.height) || 0;
  // Print copy: the raw file resized server-side by Unsplash to at most 6000 px on the long side.
  const long = Math.min(6000, Math.max(w, h));
  const k = long / Math.max(1, w, h);
  const raw = String(ph.urls?.raw ?? '');
  const download = raw ? `${raw}${raw.includes('?') ? '&' : '?'}fm=jpg&q=90&${w >= h ? 'w' : 'h'}=${long}` : String(ph.urls?.full ?? '');
  const name = ph.user?.name ?? 'an Unsplash photographer';
  return {
    item: {
      provider: 'unsplash',
      id: String(ph.id),
      thumbUrl: String(ph.urls?.small ?? ph.urls?.thumb ?? ''),
      width: w,
      height: h,
      printWidth: Math.round(w * k),
      printHeight: Math.round(h * k),
      title: String(ph.alt_description ?? ph.description ?? 'Unsplash photo').slice(0, 120),
      attribution: {
        text: `Photo by ${name} on Unsplash`,
        author: name,
        authorUrl: withUtm(String(ph.user?.links?.html ?? '')),
        sourceUrl: withUtm(String(ph.links?.html ?? '')),
        license: 'Unsplash License',
        licenseUrl: withUtm('https://unsplash.com/license'),
      },
    },
    downloadUrl: download,
    downloadHosts: UNSPLASH_IMAGES,
    trackUrl: String(ph.links?.download_location ?? ''),
  };
}

const UNSPLASH_ORIENT: Record<string, string> = { horizontal: 'landscape', vertical: 'portrait', squarish: 'squarish' };

async function unsplashSearch(q: StockSearchQuery): Promise<ProviderPage> {
  const p = new URLSearchParams({ query: q.q.slice(0, 100), per_page: String(PER_PAGE), page: String(q.page ?? 1), content_filter: 'high' });
  if (q.orientation && UNSPLASH_ORIENT[q.orientation]) p.set('orientation', UNSPLASH_ORIENT[q.orientation]);
  if (q.color && UNSPLASH_COLORS.includes(q.color)) p.set('color', q.color);
  const r = await safeGetJson<{ total: number; total_pages: number; results: any[] }>(`https://api.unsplash.com/search/photos?${p}`, { hosts: UNSPLASH_API, headers: unsplashHeaders() });
  return { items: (r.results ?? []).map(unsplashItem), total: r.total, hasMore: (q.page ?? 1) < (r.total_pages ?? 0) };
}

async function unsplashGet(id: string): Promise<ProviderItem | null> {
  const r = await safeGetJson<any>(`https://api.unsplash.com/photos/${encodeURIComponent(id)}`, { hosts: UNSPLASH_API, headers: unsplashHeaders() });
  return r?.id ? unsplashItem(r) : null;
}

/** Unsplash API guideline: trigger the download endpoint when a photo is used. */
export async function unsplashTrack(trackUrl: string) {
  if (!trackUrl) return;
  await safeGetJson(trackUrl, { hosts: UNSPLASH_API, headers: unsplashHeaders() }).catch(() => {});
}

/* ---------------- Openverse ---------------- */

const OPENVERSE_API = ['api.openverse.org'];

function openverseItem(r: any): ProviderItem | null {
  const license = String(r.license ?? '').toLowerCase();
  if (license !== 'cc0' && license !== 'pdm') return null; // belt and braces: never anything that needs permission
  const w = Number(r.width) || 0;
  const h = Number(r.height) || 0;
  const who = r.creator ? String(r.creator) : null;
  const served = servedSize(String(r.url ?? ''), w, h);
  return {
    item: {
      provider: 'openverse',
      id: String(r.id),
      thumbUrl: `/api/stock/thumb/openverse/${encodeURIComponent(String(r.id))}`,
      width: w,
      height: h,
      printWidth: served.width,
      printHeight: served.height,
      title: String(r.title ?? 'Openverse image').slice(0, 120),
      attribution: {
        text: `${r.title ? `“${String(r.title).slice(0, 80)}”` : 'Image'}${who ? ` by ${who}` : ''} — ${license === 'cc0' ? 'CC0' : 'Public Domain'} via Openverse`,
        author: who ?? undefined,
        authorUrl: r.creator_url ?? undefined,
        sourceUrl: r.foreign_landing_url ?? undefined,
        license: license === 'cc0' ? 'CC0 1.0' : 'Public Domain Mark',
        licenseUrl: r.license_url ?? undefined,
      },
    },
    // Originals are hosted by the source collection (Flickr, Wikimedia, museums…): any PUBLIC host.
    downloadUrl: String(r.url ?? ''),
    downloadHosts: '*',
    allowHttp: true,
    thumbSource: `https://api.openverse.org/v1/images/${encodeURIComponent(String(r.id))}/thumb/`,
    thumbHosts: OPENVERSE_API,
  };
}

const OPENVERSE_ASPECT: Record<string, string> = { horizontal: 'wide', vertical: 'tall', squarish: 'square' };
const OPENVERSE_CATEGORY: Record<string, string> = { photo: 'photograph', illustration: 'illustration', vector: 'digitized_artwork' };

async function openverseSearch(q: StockSearchQuery): Promise<ProviderPage> {
  const p = new URLSearchParams({ q: q.q.slice(0, 100), license: 'cc0,pdm', page: String(q.page ?? 1), page_size: '20', mature: 'false' });
  if (q.orientation && OPENVERSE_ASPECT[q.orientation]) p.set('aspect_ratio', OPENVERSE_ASPECT[q.orientation]);
  if (q.imageType && OPENVERSE_CATEGORY[q.imageType]) p.set('category', OPENVERSE_CATEGORY[q.imageType]);
  let r = await safeGetJson<{ result_count: number; page_count: number; results: any[] }>(`https://api.openverse.org/v1/images/?${p}`, { hosts: OPENVERSE_API });
  // Openverse's catalogue is small next to Pixabay's: an orientation filter often empties a search.
  // Backgrounds are cropped to the card anyway, so fall back to any orientation.
  if (!r.results?.length && p.has('aspect_ratio') && (q.page ?? 1) === 1) {
    p.delete('aspect_ratio');
    r = await safeGetJson(`https://api.openverse.org/v1/images/?${p}`, { hosts: OPENVERSE_API });
  }
  const items = (r.results ?? []).map(openverseItem).filter((x): x is ProviderItem => !!x);
  return { items, total: r.result_count, hasMore: (q.page ?? 1) < (r.page_count ?? 0) };
}

async function openverseGet(id: string): Promise<ProviderItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await safeGetJson<any>(`https://api.openverse.org/v1/images/${id}/`, { hosts: OPENVERSE_API });
  return openverseItem(r);
}

/* ---------------- Key check (Settings → Server) ---------------- */

export interface StockKeyCheck {
  /** true: the provider accepted the key. false: it rejected it. null: couldn't ask (offline, rate limit, outage). */
  valid: boolean | null;
  message: string;
}

/** Ask the provider whether a key works, with one tiny search. Never logs or returns the key. */
export async function checkStockKey(p: KeyedProvider, key: string): Promise<StockKeyCheck> {
  const name = p === 'pixabay' ? 'Pixabay' : 'Unsplash';
  try {
    const r =
      p === 'pixabay'
        ? await safeGet(`https://pixabay.com/api/?${new URLSearchParams({ key, q: 'leaves', per_page: '3' })}`, { hosts: PIXABAY_HOSTS, maxBytes: 1024 * 1024, timeoutMs: 10_000 })
        : await safeGet('https://api.unsplash.com/photos?per_page=1', { hosts: UNSPLASH_API, maxBytes: 1024 * 1024, timeoutMs: 10_000, headers: { ...unsplashHeaders(key), Accept: 'application/json' } });
    if (r.status === 200) return { valid: true, message: `${name} accepted the key.` };
    // Pixabay answers a bad key with 400 "Invalid or missing API key"; Unsplash with 401.
    if (r.status === 400 || r.status === 401 || r.status === 403) return { valid: false, message: `${name} rejected this key. Check you copied all of it.` };
    if (r.status === 429) return { valid: null, message: `${name}'s rate limit was reached, so the key couldn't be checked right now.` };
    return { valid: null, message: `${name} couldn't check the key right now (HTTP ${r.status}).` };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return { valid: null, message: `${name} couldn't be reached from this server to check the key.` };
  }
}

/* ---------------- Dispatch ---------------- */

export function searchProvider(q: StockSearchQuery): Promise<ProviderPage> {
  if (q.provider === 'pixabay') return pixabaySearch(q);
  if (q.provider === 'unsplash') return unsplashSearch(q);
  return openverseSearch(q);
}

export function getProviderItem(provider: StockProviderId, id: string): Promise<ProviderItem | null> {
  if (provider === 'pixabay') return /^\d{1,12}$/.test(id) ? pixabayGet(id) : Promise.resolve(null);
  if (provider === 'unsplash') return /^[\w-]{4,40}$/.test(id) ? unsplashGet(id) : Promise.resolve(null);
  return openverseGet(id);
}
