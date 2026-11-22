import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthState, SessionUser, UserPrefs } from '@homecard/shared';
import { VENDOR_PRESETS } from '@homecard/shared';
import { config } from '../config';
import { tx } from '../db';
import { closeStreams } from '../events';
import { uiFontsCss } from '../fonts/fonts';
import { audit } from '../security/audit';
import { randomToken } from '../security/keys';
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from '../security/passwords';
import { clearFailures, ipKey, lockedFor, recordFailure, userKey } from '../security/ratelimit';
import { createSession, revokeSession, revokeUserSessions } from '../security/sessions';
import {
  countUsers,
  displayNameProblem,
  findUserById,
  findUserByUsername,
  insertUser,
  markLogin,
  normalizeUsername,
  parsePrefs,
  setPasswordHash,
  toSessionUser,
  updateUserFields,
  usernameProblem,
  type UserRow,
} from '../security/users';
import { httpError } from '../util/fsx';
import { adoptLegacyData } from './adopt';
import { clientIp, sessionOf, userOf } from './context';
import { clearAuthCookies, CSRF_COOKIE, readCookie, setCsrfCookie, setSessionCookie } from './cookies';

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

function startSession(req: FastifyRequest, reply: FastifyReply, user: UserRow) {
  // Never reuse a pre-existing session id (session fixation): always issue a fresh token.
  const old = sessionOf(req);
  if (old) revokeSession(old.id_hash);
  const s = createSession(user.id, { ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '') });
  setSessionCookie(req, reply, s.token, s.expiresAt);
  setCsrfCookie(req, reply, s.csrfToken);
  markLogin(user.id);
  return s;
}

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));
const lockedMessage = (sec: number) =>
  `Too many failed sign-in attempts. Try again in ${minutes(sec) >= 60 ? `about ${Math.round(minutes(sec) / 60)} hour${Math.round(minutes(sec) / 60) === 1 ? '' : 's'}` : `${minutes(sec)} minute${minutes(sec) === 1 ? '' : 's'}`}.`;

/* Simple in-memory limiter for account creation (registration / setup). */
const creations = new Map<string, number[]>();
function creationAllowed(ip: string) {
  const now = Date.now();
  const list = (creations.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= 5) return false;
  list.push(now);
  creations.set(ip, list);
  return true;
}

function authHtml(): Buffer | null {
  const f = path.join(config.webDist, 'auth.html');
  try {
    return fs.readFileSync(f);
  } catch {
    return null;
  }
}

function sendAuthPage(reply: FastifyReply) {
  const html = authHtml();
  if (!html) return reply.code(503).type('text/plain').send('The web app has not been built (auth.html missing).');
  return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
}

/** Only same-site relative paths are accepted as a post-login destination (no open redirect). */
export function safeNext(v: unknown) {
  const s = typeof v === 'string' ? v : '';
  return /^\/(?![\\/])[^\s]*$/.test(s) && !s.startsWith('/login') && !s.startsWith('/setup') ? s : '/';
}

function validPrefs(p: unknown): UserPrefs {
  const out: UserPrefs = {};
  if (p && typeof p === 'object') {
    const v = (p as UserPrefs).defaultVendorId;
    if (typeof v === 'string' && VENDOR_PRESETS.some((x) => x.id === v)) out.defaultVendorId = v;
  }
  return out;
}

export function registerAuthRoutes(app: FastifyInstance) {
  /* ---------- Pages ---------- */
  app.get('/login', async (req, reply) => {
    if (countUsers() === 0) return reply.redirect('/setup');
    const p = req.principal;
    const q = req.query as { next?: string; change?: string };
    if (p?.kind === 'user' && !p.user.must_change_password) return reply.redirect(safeNext(q.next));
    return sendAuthPage(reply);
  });
  // First-run only: once any user exists /setup is permanently closed.
  app.get('/setup', async (_req, reply) => (countUsers() > 0 ? reply.redirect('/login') : sendAuthPage(reply)));
  app.get('/register', async (_req, reply) => (!config.security.allowRegistration || countUsers() === 0 ? reply.redirect('/login') : sendAuthPage(reply)));

  app.get('/health', async (_req, reply) => reply.header('Cache-Control', 'no-store').send({ status: 'ok' }));

  /* ---------- State ---------- */
  app.get('/api/auth/state', async (req, reply): Promise<AuthState> => {
    const p = req.principal;
    if (p?.kind === 'user') {
      if (readCookie(req, CSRF_COOKIE) !== p.session.csrf_token) setCsrfCookie(req, reply, p.session.csrf_token);
    } else if (!readCookie(req, CSRF_COOKIE)) {
      // Pre-sign-in double-submit token for the login/setup/register forms.
      setCsrfCookie(req, reply, randomToken(24), 60 * 60 * 12);
    }
    return {
      setupRequired: countUsers() === 0,
      allowRegistration: config.security.allowRegistration,
      user: p?.kind === 'user' ? toSessionUser(p.user) : null,
    };
  });

  app.get('/api/auth/ui-fonts.css', async (_req, reply) => reply.type('text/css; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(uiFontsCss()));

  /* ---------- First-run setup ---------- */
  app.post<{ Body: { username?: string; displayName?: string; password?: string } }>('/api/auth/setup', async (req, reply) => {
    const ip = clientIp(req);
    if (countUsers() > 0) throw httpError(409, 'Setup is already complete. Sign in instead.');
    if (!creationAllowed(ip)) throw httpError(429, 'Too many attempts. Wait an hour and try again.');
    const username = normalizeUsername(req.body?.username);
    const displayName = str(req.body?.displayName, 80).trim() || username;
    const password = str(req.body?.password, 500);
    const problem = usernameProblem(username) ?? displayNameProblem(displayName) ?? passwordProblem(password, username);
    if (problem) throw httpError(400, problem);
    const hash = await hashPassword(password);
    // Re-check inside a write transaction so two simultaneous setups can't both succeed.
    const user = tx(() => {
      if (countUsers() > 0) throw httpError(409, 'Setup is already complete. Sign in instead.');
      return insertUser({ username, displayName, passwordHash: hash, role: 'admin', mustChangePassword: false });
    });
    audit({ event: 'auth.setup', userId: user.id, username: user.username, ip, detail: { role: 'admin' } });
    try {
      const adopted = await adoptLegacyData(user, (m) => req.log.info(m));
      if (adopted.projects || adopted.exports || adopted.uploads) audit({ event: 'setup.legacy_adopted', userId: user.id, username: user.username, ip, detail: { ...adopted } });
    } catch (err: any) {
      req.log.error(err, 'adopting existing data failed');
    }
    startSession(req, reply, user);
    return { user: toSessionUser(user) };
  });

  /* ---------- Sign in ---------- */
  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const ip = clientIp(req);
    const username = normalizeUsername(str(req.body?.username, 64));
    const password = str(req.body?.password, 500);
    if (!username || !password) throw httpError(400, 'Enter your username and password.');
    const keys = [ipKey(ip), userKey(username)];
    const locked = lockedFor(keys);
    if (locked) {
      audit({ event: 'auth.login_failed', outcome: 'denied', username, ip, detail: { reason: 'locked', retryAfterSec: locked } });
      return reply.code(429).header('Retry-After', String(locked)).send({ error: lockedMessage(locked), code: 'locked', retryAfterSec: locked });
    }
    const user = findUserByUsername(username);
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
    if (!user || !ok) {
      const lockSec = recordFailure(keys);
      audit({ event: 'auth.login_failed', outcome: 'denied', userId: user?.id ?? null, username, ip, detail: { reason: user ? 'bad_password' : 'unknown_user' } });
      if (lockSec) {
        audit({ event: 'auth.locked_out', outcome: 'denied', userId: user?.id ?? null, username, ip, detail: { lockSec } });
        return reply.code(429).header('Retry-After', String(lockSec)).send({ error: lockedMessage(lockSec), code: 'locked', retryAfterSec: lockSec });
      }
      throw httpError(401, 'Incorrect username or password.');
    }
    if (user.disabled) {
      audit({ event: 'auth.login_failed', outcome: 'denied', userId: user.id, username, ip, detail: { reason: 'disabled' } });
      throw httpError(403, 'This account is disabled. Ask your HomeCard admin.');
    }
    clearFailures(userKey(username));
    startSession(req, reply, user);
    audit({ event: 'auth.login', userId: user.id, username: user.username, ip });
    return { user: toSessionUser(user) };
  });

  /* ---------- Open registration (off unless ALLOW_REGISTRATION=true) ---------- */
  app.post<{ Body: { username?: string; displayName?: string; password?: string } }>('/api/auth/register', async (req, reply) => {
    const ip = clientIp(req);
    if (!config.security.allowRegistration || countUsers() === 0) throw httpError(403, 'Registration is closed. Ask your HomeCard admin for an account.');
    if (!creationAllowed(ip)) throw httpError(429, 'Too many accounts created from this device. Try again later.');
    const username = normalizeUsername(req.body?.username);
    const displayName = str(req.body?.displayName, 80).trim() || username;
    const password = str(req.body?.password, 500);
    const problem = usernameProblem(username) ?? displayNameProblem(displayName) ?? passwordProblem(password, username);
    if (problem) throw httpError(400, problem);
    if (findUserByUsername(username)) throw httpError(409, 'That username is taken.');
    const user = insertUser({ username, displayName, passwordHash: await hashPassword(password), role: 'user', mustChangePassword: false });
    audit({ event: 'auth.registered', userId: user.id, username: user.username, ip });
    startSession(req, reply, user);
    return { user: toSessionUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const s = sessionOf(req);
    if (s) {
      revokeSession(s.id_hash);
      closeStreams({ sessionHashes: [s.id_hash] });
      const u = req.principal?.kind === 'user' ? req.principal.user : null;
      audit({ event: 'auth.logout', userId: u?.id, username: u?.username, ip: clientIp(req) });
    }
    clearAuthCookies(req, reply);
    return { ok: true };
  });

  /* ---------- Current user ---------- */
  app.get('/api/auth/me', async (req, reply): Promise<SessionUser> => {
    const p = req.principal;
    if (p?.kind !== 'user') throw httpError(401, 'Sign in required');
    if (readCookie(req, CSRF_COOKIE) !== p.session.csrf_token) setCsrfCookie(req, reply, p.session.csrf_token);
    return toSessionUser(p.user);
  });

  app.put<{ Body: { displayName?: string; prefs?: UserPrefs } }>('/api/auth/me', async (req): Promise<SessionUser> => {
    const me = userOf(req);
    const patch: { displayName?: string; prefs?: UserPrefs } = {};
    if (typeof req.body?.displayName === 'string') {
      const problem = displayNameProblem(req.body.displayName);
      if (problem) throw httpError(400, problem);
      patch.displayName = req.body.displayName;
    }
    if (req.body?.prefs) patch.prefs = { ...parsePrefs(findUserById(me.userId)!.prefs), ...validPrefs(req.body.prefs) };
    return toSessionUser(updateUserFields(me.userId, patch)!);
  });

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/api/auth/password', async (req, reply) => {
    const p = req.principal;
    if (p?.kind !== 'user') throw httpError(401, 'Sign in required');
    const ip = clientIp(req);
    const user = p.user;
    const locked = lockedFor([userKey(user.username)]);
    if (locked) return reply.code(429).header('Retry-After', String(locked)).send({ error: lockedMessage(locked), code: 'locked' });
    const current = str(req.body?.currentPassword, 500);
    const next = str(req.body?.newPassword, 500);
    if (!(await verifyPassword(current, user.password_hash))) {
      recordFailure([userKey(user.username), ipKey(ip)]);
      audit({ event: 'auth.password_changed', outcome: 'denied', userId: user.id, username: user.username, ip, detail: { reason: 'bad_current_password' } });
      throw httpError(400, 'Your current password is incorrect.');
    }
    const problem = passwordProblem(next, user.username);
    if (problem) throw httpError(400, problem);
    if (await verifyPassword(next, user.password_hash)) throw httpError(400, 'Choose a password different from the current one.');
    setPasswordHash(user.id, await hashPassword(next), false);
    // Sign out every other device and rotate this session's token.
    const revoked = revokeUserSessions(user.id);
    closeStreams({ sessionHashes: revoked });
    const fresh = findUserById(user.id)!;
    req.principal = null;
    startSession(req, reply, fresh);
    audit({ event: 'auth.password_changed', userId: user.id, username: user.username, ip, detail: { otherSessionsRevoked: Math.max(0, revoked.length - 1) } });
    return { user: toSessionUser(fresh) };
  });
}
