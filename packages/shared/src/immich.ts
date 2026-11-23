/**
 * Immich read-only policy, shared by the server (enforcement) and the UI (setup checklist).
 *
 * Layer 1 — outbound allowlist: the server's ReadOnlyImmichClient only ever sends the requests
 * listed here. DELETE / PUT / PATCH are a fatal error, and so is any other method or path.
 * Layer 2 — key scopes: a user's API key is inspected with GET /api/api-keys/me and refused if it
 * carries any permission that could change or delete something.
 */

export const IMMICH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET endpoints HomeCard may call. ":id" must be an Immich UUID. */
export const IMMICH_GET_ALLOWLIST = [
  '/api/server/ping',
  '/api/users/me',
  '/api/api-keys/me',
  '/api/albums',
  '/api/albums/:id',
  '/api/assets/:id',
  '/api/assets/:id/thumbnail',
  '/api/assets/:id/original',
  '/api/people',
  '/api/people/:id',
  '/api/people/:id/thumbnail',
  '/api/faces',
  '/api/memories',
  // Tags are only ever listed and read. Creating, renaming, deleting and tagging assets stay blocked.
  '/api/tags',
  '/api/tags/:id',
] as const;

/** POST endpoints HomeCard may call — Immich's read-only search endpoints only. */
export const IMMICH_POST_ALLOWLIST = ['/api/search/metadata', '/api/search/smart', '/api/search/random'] as const;

export const IMMICH_MUTATING_METHODS = ['DELETE', 'PUT', 'PATCH'] as const;

export type ImmichRequestCheck =
  | { ok: true; method: 'GET' | 'POST'; pathname: string; search: string; route: string }
  | { ok: false; fatal: boolean; reason: string };

function matchRoute(pathname: string, routes: readonly string[]): string | null {
  const segs = pathname.split('/');
  for (const r of routes) {
    const rs = r.split('/');
    if (rs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i] === ':id') {
        if (!IMMICH_UUID.test(segs[i])) {
          ok = false;
          break;
        }
      } else if (rs[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return r;
  }
  return null;
}

/**
 * Decide whether a request to Immich is allowed. `path` is the path + optional query string,
 * relative to the Immich base URL (e.g. "/api/assets/<uuid>/thumbnail?size=preview").
 */
export function checkImmichRequest(method: string, path: string): ImmichRequestCheck {
  const m = String(method ?? '').toUpperCase();
  if ((IMMICH_MUTATING_METHODS as readonly string[]).includes(m)) {
    return { ok: false, fatal: true, reason: `Blocked ${m} ${String(path).split('?')[0]}: HomeCard never modifies or deletes anything in Immich.` };
  }
  if (m !== 'GET' && m !== 'POST') return { ok: false, fatal: true, reason: `Blocked ${m || '(no method)'} request to Immich: only GET and read-only search POSTs are allowed.` };
  if (typeof path !== 'string' || !path.startsWith('/api/')) return { ok: false, fatal: true, reason: 'Blocked Immich request: path must start with /api/.' };
  if (path.length > 2048) return { ok: false, fatal: true, reason: 'Blocked Immich request: path too long.' };
  const q = path.indexOf('?');
  const pathname = q < 0 ? path : path.slice(0, q);
  const search = q < 0 ? '' : path.slice(q);
  // No traversal, encoded separators, backslashes, empty segments, fragments or odd characters.
  if (!/^\/api(\/[A-Za-z0-9._-]+)+$/.test(pathname) || pathname.split('/').some((s) => s === '.' || s === '..')) {
    return { ok: false, fatal: true, reason: `Blocked Immich request to a malformed path: ${pathname.slice(0, 80)}` };
  }
  if (search.includes('#') || /[\s\\]/.test(search)) return { ok: false, fatal: true, reason: 'Blocked Immich request: malformed query string.' };
  if (m === 'GET') {
    const route = matchRoute(pathname, IMMICH_GET_ALLOWLIST);
    if (!route) return { ok: false, fatal: true, reason: `Blocked GET ${pathname}: not on HomeCard's read-only Immich allowlist.` };
    return { ok: true, method: 'GET', pathname, search, route };
  }
  if (search) return { ok: false, fatal: true, reason: `Blocked POST ${pathname}: search requests carry no query string.` };
  const route = matchRoute(pathname, IMMICH_POST_ALLOWLIST);
  if (!route) return { ok: false, fatal: true, reason: `Blocked POST ${pathname}: only Immich's read-only search endpoints may be POSTed to.` };
  return { ok: true, method: 'POST', pathname, search, route };
}

/* ---------------------------------------------------------------- */
/* Layer 2: API key scopes                                           */
/* ---------------------------------------------------------------- */

export interface ImmichScopeInfo {
  id: string;
  label: string;
  why: string;
}

/** Exactly what to tick in Immich → Account Settings → API Keys → New API Key. */
export const IMMICH_REQUIRED_SCOPES: ImmichScopeInfo[] = [
  { id: 'album.read', label: 'album.read', why: 'List your albums' },
  { id: 'asset.read', label: 'asset.read', why: 'Browse and search photos' },
  { id: 'asset.view', label: 'asset.view', why: 'Show thumbnails and previews' },
  { id: 'asset.download', label: 'asset.download', why: 'Fetch full-resolution originals for 300 DPI prints' },
  { id: 'person.read', label: 'person.read', why: 'Browse by person and frame faces' },
  { id: 'apiKey.read', label: 'apiKey.read', why: 'Lets HomeCard confirm the key is read-only' },
];

export const IMMICH_OPTIONAL_SCOPES: ImmichScopeInfo[] = [
  { id: 'memory.read', label: 'memory.read', why: 'Optional: "On this day" memories' },
  { id: 'tag.read', label: 'tag.read', why: 'Optional: match your Immich tags to upcoming holidays' },
];

/** Permission actions that only read. Anything else is treated as able to change data. */
const READ_ACTIONS = new Set(['read', 'view', 'download', 'statistics', 'search', 'about', 'storage', 'versionCheck', 'apkLinks']);

export interface ImmichScopeAnalysis {
  /** Permissions that could create, change, delete, upload, share or administer something. */
  dangerous: string[];
  missingRequired: string[];
  missingOptional: string[];
  readOnly: boolean;
}

/**
 * Classify a key's permissions. Refused: "all", any *.delete / *.create / *.update / *.write,
 * admin*, asset.upload — and, to be safe, any permission whose action is not a pure read.
 */
export function analyzeImmichScopes(permissions: readonly string[]): ImmichScopeAnalysis {
  const perms = [...new Set(permissions.map((p) => String(p).trim()).filter(Boolean))];
  const dangerous = perms.filter((p) => {
    if (p === 'all') return true;
    if (/^admin/i.test(p)) return true;
    if (p === 'asset.upload') return true;
    if (/\.(delete|create|update|write)$/i.test(p)) return true;
    const dot = p.lastIndexOf('.');
    const action = dot < 0 ? p : p.slice(dot + 1);
    return !READ_ACTIONS.has(action);
  });
  const has = new Set(perms);
  return {
    dangerous,
    missingRequired: IMMICH_REQUIRED_SCOPES.map((s) => s.id).filter((s) => !has.has(s)),
    missingOptional: IMMICH_OPTIONAL_SCOPES.map((s) => s.id).filter((s) => !has.has(s)),
    readOnly: dangerous.length === 0,
  };
}
