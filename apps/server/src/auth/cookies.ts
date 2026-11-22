import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';

/**
 * Cookie names. Over HTTPS the __Host- prefix is used: the browser then refuses the cookie
 * unless it is Secure, host-only and Path=/ (no sibling-subdomain overwrites).
 */
export const SESSION_COOKIE = 'hc_session';
export const CSRF_COOKIE = 'hc_csrf';

export function isSecureRequest(req: FastifyRequest) {
  return config.security.https || req.protocol === 'https';
}

const nameFor = (base: string, secure: boolean) => (secure ? `__Host-${base}` : base);

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function readCookie(req: FastifyRequest, base: string): string | undefined {
  const c = parseCookies(req.headers.cookie);
  return c[`__Host-${base}`] ?? c[base];
}

function serialize(name: string, value: string, o: { httpOnly: boolean; sameSite: 'Lax' | 'Strict'; secure: boolean; maxAgeSec: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${o.sameSite}`, `Max-Age=${Math.max(0, Math.floor(o.maxAgeSec))}`];
  if (o.httpOnly) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

function append(reply: FastifyReply, cookie: string) {
  const prev = reply.getHeader('set-cookie');
  const list = Array.isArray(prev) ? prev.map(String) : prev ? [String(prev)] : [];
  reply.header('set-cookie', [...list, cookie]);
}

/** HttpOnly, SameSite=Lax session cookie (Secure over HTTPS / when HTTPS=true). */
export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string, expiresAt: number) {
  const secure = isSecureRequest(req);
  append(reply, serialize(nameFor(SESSION_COOKIE, secure), token, { httpOnly: true, sameSite: 'Lax', secure, maxAgeSec: (expiresAt - Date.now()) / 1000 }));
}

/**
 * CSRF token cookie: readable by the page's script (it echoes it in the X-CSRF-Token header),
 * SameSite=Strict so no other site ever causes it to be sent.
 */
export function setCsrfCookie(req: FastifyRequest, reply: FastifyReply, token: string, maxAgeSec = 60 * 60 * 24 * 60) {
  const secure = isSecureRequest(req);
  append(reply, serialize(nameFor(CSRF_COOKIE, secure), token, { httpOnly: false, sameSite: 'Strict', secure, maxAgeSec }));
}

export function clearAuthCookies(req: FastifyRequest, reply: FastifyReply) {
  for (const secure of [true, false]) {
    if (secure && !isSecureRequest(req)) continue;
    append(reply, serialize(nameFor(SESSION_COOKIE, secure), '', { httpOnly: true, sameSite: 'Lax', secure, maxAgeSec: 0 }));
    append(reply, serialize(nameFor(CSRF_COOKIE, secure), '', { httpOnly: false, sameSite: 'Strict', secure, maxAgeSec: 0 }));
  }
}
