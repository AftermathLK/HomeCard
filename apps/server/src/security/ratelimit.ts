import { one, run } from '../db';

/**
 * Brute-force protection for sign-in. Failures are counted per IP ("ip:<addr>") and per
 * username ("user:<name>"), persisted in SQLite so a restart doesn't reset them.
 *
 *  - 5 failed attempts inside 15 minutes lock that key.
 *  - Lockouts are progressive: 15 min, 30 min, 1 h, 2 h … capped at 24 h.
 *  - The lockout counter decays after 24 h without failures.
 *  - A locked key is refused BEFORE the password is checked, so a lockout can't be bypassed by
 *    eventually guessing right.
 */

export const LOGIN_POLICY = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  baseLockMs: 15 * 60_000,
  maxLockMs: 24 * 60 * 60_000,
  decayMs: 24 * 60 * 60_000,
};

interface AttemptRow {
  key: string;
  failures: number;
  window_start: number;
  last_failure: number;
  locked_until: number;
  lockouts: number;
}

export const ipKey = (ip: string) => `ip:${ip}`;
export const userKey = (username: string) => `user:${username.toLowerCase()}`;

/** Seconds until every key is unlocked (0 = allowed). */
export function lockedFor(keys: string[], now = Date.now()): number {
  let until = 0;
  for (const k of keys) {
    const r = one<AttemptRow>('SELECT * FROM login_attempts WHERE key = ?', k);
    if (r && r.locked_until > now) until = Math.max(until, r.locked_until);
  }
  return until ? Math.ceil((until - now) / 1000) : 0;
}

/** Record a failure for each key. Returns the lock duration (seconds) if this failure caused a lockout. */
export function recordFailure(keys: string[], now = Date.now()): number {
  let locked = 0;
  for (const k of keys) {
    const r: AttemptRow = one<AttemptRow>('SELECT * FROM login_attempts WHERE key = ?', k) ?? {
      key: k,
      failures: 0,
      window_start: now,
      last_failure: now,
      locked_until: 0,
      lockouts: 0,
    };
    if (now - r.window_start > LOGIN_POLICY.windowMs) {
      r.failures = 0;
      r.window_start = now;
    }
    if (now - r.last_failure > LOGIN_POLICY.decayMs) r.lockouts = 0;
    r.failures += 1;
    r.last_failure = now;
    if (r.failures >= LOGIN_POLICY.maxFailures) {
      const ms = Math.min(LOGIN_POLICY.baseLockMs * 2 ** r.lockouts, LOGIN_POLICY.maxLockMs);
      r.lockouts += 1;
      r.locked_until = now + ms;
      r.failures = 0;
      r.window_start = now;
      locked = Math.max(locked, Math.ceil(ms / 1000));
    }
    run(
      `INSERT INTO login_attempts(key, failures, window_start, last_failure, locked_until, lockouts) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start,
         last_failure = excluded.last_failure, locked_until = excluded.locked_until, lockouts = excluded.lockouts`,
      r.key,
      r.failures,
      r.window_start,
      r.last_failure,
      r.locked_until,
      r.lockouts,
    );
  }
  return locked;
}

/** A successful sign-in clears the username's counter (the IP counter decays on its own). */
export function clearFailures(key: string) {
  run('DELETE FROM login_attempts WHERE key = ?', key);
}

export function isLocked(key: string, now = Date.now()) {
  return lockedFor([key], now) > 0;
}

export function purgeOldAttempts(now = Date.now()) {
  run('DELETE FROM login_attempts WHERE locked_until < ? AND last_failure < ?', now, now - LOGIN_POLICY.decayMs);
}
