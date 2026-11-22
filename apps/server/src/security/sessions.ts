import { config } from '../config';
import { all, one, run } from '../db';
import { randomToken, sessionDigest } from './keys';
import { findUserById, type UserRow } from './users';

/**
 * Server-side sessions. The browser holds a random 256-bit token in an HttpOnly cookie; the
 * database stores only HMAC-SHA256(token) plus a per-session CSRF token.
 *  - idle expiry:     SESSION_IDLE_DAYS without a request (default 14)
 *  - absolute expiry: SESSION_MAX_DAYS after sign-in (default 60)
 * Password changes, resets, disabling and deleting a user revoke their sessions immediately.
 */

export interface SessionRow {
  id_hash: string;
  user_id: string;
  csrf_token: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

const DAY = 86_400_000;
const TOUCH_EVERY = 5 * 60_000;

const idleMs = () => config.security.sessionIdleDays * DAY;
const maxMs = () => config.security.sessionMaxDays * DAY;

export function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const now = Date.now();
  const expiresAt = Math.min(now + idleMs(), now + maxMs());
  run(
    'INSERT INTO sessions(id_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
    sessionDigest(token),
    userId,
    csrfToken,
    now,
    now,
    expiresAt,
    meta.ip ?? null,
    (meta.userAgent ?? '').slice(0, 200) || null,
  );
  return { token, csrfToken, idHash: sessionDigest(token), expiresAt };
}

/** Resolve a cookie token to an active session + enabled user, sliding the idle expiry. */
export function lookupSession(token: string | undefined | null): { session: SessionRow; user: UserRow } | null {
  if (!token || token.length < 20 || token.length > 200) return null;
  const idHash = sessionDigest(token);
  const s = one<SessionRow>('SELECT * FROM sessions WHERE id_hash = ?', idHash);
  if (!s) return null;
  const now = Date.now();
  if (s.expires_at <= now || s.created_at + maxMs() <= now) {
    run('DELETE FROM sessions WHERE id_hash = ?', idHash);
    return null;
  }
  const user = findUserById(s.user_id);
  if (!user || user.disabled) {
    run('DELETE FROM sessions WHERE id_hash = ?', idHash);
    return null;
  }
  if (now - s.last_seen_at > TOUCH_EVERY) {
    const expiresAt = Math.min(now + idleMs(), s.created_at + maxMs());
    run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?', now, expiresAt, idHash);
    s.last_seen_at = now;
    s.expires_at = expiresAt;
  }
  return { session: s, user };
}

export function revokeSession(idHash: string) {
  run('DELETE FROM sessions WHERE id_hash = ?', idHash);
}

/** Revoke every session of a user, optionally keeping the current one. Returns revoked id hashes. */
export function revokeUserSessions(userId: string, keepIdHash?: string): string[] {
  const rows = all<{ id_hash: string }>('SELECT id_hash FROM sessions WHERE user_id = ?', userId).map((r) => r.id_hash).filter((h) => h !== keepIdHash);
  for (const h of rows) run('DELETE FROM sessions WHERE id_hash = ?', h);
  return rows;
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
}

export function countUserSessions(userId: string) {
  return Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', userId, Date.now())?.n ?? 0);
}
