import { randomToken, safeEqual } from '../security/keys';
import type { EphemeralScope } from '../util/ephemeral';

/**
 * Render grants: how the headless Chromium renderer gets through the auth wall.
 *
 * Each render job gets its own random token, sent by Chromium as the X-HomeCard-Render header
 * (Playwright extraHTTPHeaders). A grant is bound to ONE job and ONE user: the renderer can read
 * that job, that user's photos and the shared fonts/styles — GET only — and nothing else.
 * Grants expire with the job (15 minutes at most) and are revoked as soon as it finishes.
 */

export const RENDER_HEADER = 'x-homecard-render';

export interface RenderGrant {
  token: string;
  jobId: string;
  userId: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  /** Private working directory for Immich originals during this render. */
  scope: EphemeralScope | null;
  expires: number;
}

const TTL = 15 * 60_000;
const grants = new Map<string, RenderGrant>();

export function issueGrant(owner: { userId: string; username: string; displayName: string; role: 'admin' | 'user' }, jobId: string, scope: EphemeralScope | null): RenderGrant {
  const g: RenderGrant = { token: randomToken(32), jobId, ...owner, scope, expires: Date.now() + TTL };
  grants.set(g.token, g);
  return g;
}

export function lookupGrant(token: string | undefined): RenderGrant | null {
  if (!token || token.length < 20) return null;
  // Map lookup by token, then a constant-time compare of the stored value.
  const g = grants.get(token);
  if (!g || !safeEqual(g.token, token)) return null;
  if (g.expires < Date.now()) {
    grants.delete(token);
    return null;
  }
  return g;
}

export function revokeGrant(token: string) {
  grants.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, g] of grants) if (g.expires < now) grants.delete(k);
}, 60_000).unref();

/** Paths the renderer may GET (everything else is refused even with a valid grant). */
export function renderPathAllowed(pathname: string) {
  return (
    pathname === '/render.html' ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/textures/') ||
    pathname === '/favicon.svg' ||
    pathname.startsWith('/fonts/bundled/') ||
    pathname.startsWith('/fonts/custom/') ||
    pathname === '/api/fonts/fonts.css' ||
    pathname === '/api/fonts' ||
    pathname === '/api/styles' ||
    pathname.startsWith('/api/styles/file/') ||
    pathname.startsWith('/api/stock/file/') ||
    pathname === '/api/backgrounds/soft' ||
    pathname.startsWith('/api/render/jobs/') ||
    pathname === '/api/media/print' ||
    pathname === '/api/media/preview' ||
    pathname === '/api/media/thumb'
  );
}
