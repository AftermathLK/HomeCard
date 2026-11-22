import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { uiFontFiles } from '../fonts/fonts';
import { lookupGrant, RENDER_HEADER, renderPathAllowed } from '../render/grants';
import { audit } from '../security/audit';
import { safeEqual } from '../security/keys';
import { lookupSession } from '../security/sessions';
import { countUsers } from '../security/users';
import { clientIp, type Principal } from './context';
import { CSRF_COOKIE, readCookie, SESSION_COOKIE } from './cookies';

/**
 * The auth wall. Runs before every route (API, pages, static files, fonts, media, exports).
 *
 * Unauthenticated access is limited to:
 *   GET  /health  /login  /setup  /register  /api/auth/state  /api/auth/ui-fonts.css
 *   GET  the login page's own JS/CSS bundle (from the Vite manifest) + the two UI font files
 *   POST /api/auth/login  /api/auth/setup (only while no user exists)  /api/auth/register (only if enabled)
 *
 * Every state-changing request (POST/PUT/PATCH/DELETE) must carry X-CSRF-Token matching the
 * session's CSRF token (or, before sign-in, the double-submit CSRF cookie) and, when the browser
 * sends Origin/Referer, come from this same origin.
 */

const PUBLIC_GET = new Set(['/health', '/login', '/setup', '/register', '/api/auth/state', '/api/auth/ui-fonts.css', '/favicon.svg']);
const PUBLIC_POST = new Set(['/api/auth/login', '/api/auth/setup', '/api/auth/register']);
/** What a user who must change their password may still reach. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/state', '/api/auth/me', '/api/auth/password', '/api/auth/logout', '/api/auth/ui-fonts.css', '/login', '/health', '/favicon.svg']);

let publicAssets = new Set<string>();

/** Collect the login page's bundle (entry + imports + CSS) from Vite's build manifest. */
export function loadPublicAssets(log: (m: string) => void) {
  const set = new Set<string>();
  const mfFile = [path.join(config.webDist, '.vite', 'manifest.json'), path.join(config.webDist, 'manifest.json')].find((f) => fs.existsSync(f));
  if (mfFile) {
    try {
      const mf = JSON.parse(fs.readFileSync(mfFile, 'utf8')) as Record<string, { file: string; css?: string[]; assets?: string[]; imports?: string[]; isEntry?: boolean }>;
      const seen = new Set<string>();
      const visit = (key: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        const e = mf[key];
        if (!e) return;
        set.add(`/${e.file}`);
        for (const c of e.css ?? []) set.add(`/${c}`);
        for (const a of e.assets ?? []) set.add(`/${a}`);
        for (const i of e.imports ?? []) visit(i);
      };
      for (const key of Object.keys(mf)) if (/(^|\/)auth\.html$/.test(key)) visit(key);
    } catch (err: any) {
      log(`Could not read the web build manifest (${err.message}); the login page may not load.`);
    }
  } else if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    log('Web build has no manifest (.vite/manifest.json) — rebuild the web app; the login page needs it.');
  }
  for (const f of uiFontFiles()) set.add(`/fonts/bundled/${f}`);
  publicAssets = set;
  return set.size;
}

function resolvePrincipal(req: FastifyRequest): Principal | null {
  const renderToken = req.headers[RENDER_HEADER];
  if (typeof renderToken === 'string' && renderToken) {
    const grant = lookupGrant(renderToken);
    return grant ? { kind: 'render', grant } : null;
  }
  const s = lookupSession(readCookie(req, SESSION_COOKIE));
  return s ? { kind: 'user', user: s.user, session: s.session } : null;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOrigin(value: string, req: FastifyRequest) {
  try {
    const u = new URL(value);
    return u.host.toLowerCase() === String(req.host ?? req.headers.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

function csrfFailure(req: FastifyRequest): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') {
    if (!sameOrigin(origin, req)) return 'cross-origin request';
  } else {
    const ref = req.headers.referer;
    if (typeof ref === 'string' && ref && !sameOrigin(ref, req)) return 'cross-origin referer';
  }
  const header = req.headers['x-csrf-token'];
  if (typeof header !== 'string' || header.length < 20) return 'missing CSRF token';
  const p = req.principal;
  if (p?.kind === 'user') return safeEqual(header, p.session.csrf_token) ? null : 'CSRF token mismatch';
  const cookie = readCookie(req, CSRF_COOKIE);
  return cookie && safeEqual(header, cookie) ? null : 'CSRF token mismatch';
}

function wantsPage(req: FastifyRequest, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname.startsWith('/api/') || pathname.startsWith('/fonts/') || pathname.startsWith('/assets/')) return false;
  const accept = String(req.headers.accept ?? '');
  return accept.includes('text/html') || !path.extname(pathname);
}

function deny(reply: FastifyReply, code: number, error: string, extra: Record<string, unknown> = {}) {
  return reply.code(code).header('Cache-Control', 'no-store').send({ error, ...extra });
}

export function registerAuthGuard(app: FastifyInstance) {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (req, reply) => {
    const pathname = req.url.split('?')[0];
    req.principal = resolvePrincipal(req);
    const p = req.principal;

    // Headless renderer: read-only, narrow set of paths, bound to its job and user.
    if (p?.kind === 'render') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return deny(reply, 403, 'The renderer is read-only');
      if (!renderPathAllowed(pathname)) {
        req.log.warn({ path: pathname }, 'Renderer request refused (not on the renderer allowlist)');
        return deny(reply, 403, 'Not available to the renderer');
      }
      return;
    }

    if (UNSAFE.has(req.method)) {
      const why = csrfFailure(req);
      if (why) {
        audit({ event: 'security.csrf_rejected', outcome: 'denied', userId: p?.kind === 'user' ? p.user.id : null, username: p?.kind === 'user' ? p.user.username : null, ip: clientIp(req), detail: { path: pathname, method: req.method, reason: why } });
        return deny(reply, 403, 'This request was blocked by CSRF protection. Reload the page and try again.', { code: 'csrf' });
      }
    }

    const isPublic =
      ((req.method === 'GET' || req.method === 'HEAD') && (PUBLIC_GET.has(pathname) || publicAssets.has(pathname))) ||
      (req.method === 'POST' && PUBLIC_POST.has(pathname));
    if (isPublic) return;

    if (!p) {
      if (wantsPage(req, pathname)) {
        const target = countUsers() === 0 ? '/setup' : `/login${pathname !== '/' ? `?next=${encodeURIComponent(req.url)}` : ''}`;
        return reply.code(302).header('Cache-Control', 'no-store').redirect(target);
      }
      return deny(reply, 401, 'Sign in required', { code: 'auth_required' });
    }

    if (p.user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(pathname) && !publicAssets.has(pathname)) {
      if (wantsPage(req, pathname)) return reply.code(302).header('Cache-Control', 'no-store').redirect('/login?change=1');
      return deny(reply, 403, 'Choose a new password first', { code: 'password_change_required' });
    }

    // Pages people must not open directly.
    if (pathname === '/render.html') return deny(reply, 404, 'Not found');
    if (pathname === '/auth.html') return reply.code(302).redirect('/login');
  });
}
