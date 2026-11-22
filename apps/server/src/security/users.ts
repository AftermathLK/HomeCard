import crypto from 'node:crypto';
import type { AdminUserDto, SessionUser, UserPrefs, UserRole } from '@homecard/shared';
import { all, one, run } from '../db';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  must_change_password: number;
  disabled: number;
  prefs: string;
  created_at: number;
  updated_at: number;
  password_changed_at: number;
  last_login_at: number | null;
}

/** Lower-case, 2–32 chars, starts with a letter/digit. Used verbatim as /data/photos/users/<username>. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export const normalizeUsername = (s: unknown) => String(s ?? '').trim().toLowerCase();

export function usernameProblem(username: string): string | null {
  if (!USERNAME_RE.test(username)) return 'Usernames are 2–32 characters: lower-case letters, digits, dot, dash or underscore, starting with a letter or digit.';
  if (/\.\.|^\.|\.$/.test(username)) return 'Usernames can’t start or end with a dot or contain “..”.';
  return null;
}

export function displayNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter a display name.';
  if (n.length > 60) return 'Display names are at most 60 characters.';
  if (/[\u0000-\u001f<>]/.test(n)) return 'Display names can’t contain < > or control characters.';
  return null;
}

export const newUserId = () => `u_${crypto.randomBytes(9).toString('hex')}`;

export function parsePrefs(raw: string): UserPrefs {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as UserPrefs) : {};
  } catch {
    return {};
  }
}

export function toSessionUser(r: UserRow): SessionUser {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    mustChangePassword: !!r.must_change_password,
    prefs: parsePrefs(r.prefs),
  };
}

export const countUsers = () => Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0);
export const countActiveAdmins = () => Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")?.n ?? 0);
export const findUserById = (id: string) => one<UserRow>('SELECT * FROM users WHERE id = ?', id);
export const findUserByUsername = (username: string) => one<UserRow>('SELECT * FROM users WHERE username = ?', normalizeUsername(username));
export const listUserRows = () => all<UserRow>('SELECT * FROM users ORDER BY role = \'admin\' DESC, display_name COLLATE NOCASE');

export function insertUser(u: { username: string; displayName: string; passwordHash: string; role: UserRole; mustChangePassword: boolean }): UserRow {
  const now = Date.now();
  const id = newUserId();
  run(
    `INSERT INTO users(id, username, display_name, password_hash, role, must_change_password, disabled, prefs, created_at, updated_at, password_changed_at)
     VALUES(?, ?, ?, ?, ?, ?, 0, '{}', ?, ?, ?)`,
    id,
    normalizeUsername(u.username),
    u.displayName.trim(),
    u.passwordHash,
    u.role,
    u.mustChangePassword ? 1 : 0,
    now,
    now,
    now,
  );
  return findUserById(id)!;
}

export function updateUserFields(id: string, patch: { displayName?: string; role?: UserRole; disabled?: boolean; prefs?: UserPrefs }) {
  const cur = findUserById(id);
  if (!cur) return undefined;
  run(
    'UPDATE users SET display_name = ?, role = ?, disabled = ?, prefs = ?, updated_at = ? WHERE id = ?',
    patch.displayName !== undefined ? patch.displayName.trim() : cur.display_name,
    patch.role ?? cur.role,
    patch.disabled === undefined ? cur.disabled : patch.disabled ? 1 : 0,
    patch.prefs !== undefined ? JSON.stringify(patch.prefs) : cur.prefs,
    Date.now(),
    id,
  );
  return findUserById(id);
}

export function setPasswordHash(id: string, hash: string, mustChange: boolean) {
  const now = Date.now();
  run('UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', hash, mustChange ? 1 : 0, now, now, id);
}

export function markLogin(id: string) {
  run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), id);
}

export function deleteUserRow(id: string) {
  run('DELETE FROM users WHERE id = ?', id);
}

export function toAdminDto(r: UserRow, extra: { locked: boolean; immichLinked: boolean }): AdminUserDto {
  return {
    ...toSessionUser(r),
    disabled: !!r.disabled,
    createdAt: new Date(r.created_at).toISOString(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    locked: extra.locked,
    immichLinked: extra.immichLinked,
  };
}
