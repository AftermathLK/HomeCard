import type { FastifyInstance } from 'fastify';
import type { AdminUserDto, ServerSettingsDto, StockKeySaveResult, UserDirectoryEntry, UserRole } from '@homecard/shared';
import { config } from '../config';
import { one, tx } from '../db';
import { closeStreams } from '../events';
import { immichServerUrl, setImmichServerUrl } from '../immich/credentials';
import { audit, listAudit } from '../security/audit';
import { hashPassword, passwordProblem } from '../security/passwords';
import { clearFailures, isLocked, userKey } from '../security/ratelimit';
import { revokeUserSessions } from '../security/sessions';
import {
  countActiveAdmins,
  deleteUserRow,
  displayNameProblem,
  findUserById,
  findUserByUsername,
  insertUser,
  listUserRows,
  normalizeUsername,
  setPasswordHash,
  toAdminDto,
  updateUserFields,
  usernameProblem,
  type UserRow,
} from '../security/users';
import { forgetUserExports } from '../render/exporter';
import { KEYED_PROVIDERS, normalizeStockKey, openverseEnabled, setOpenverseEnabled, setStockKey, stockKeyStatus, type KeyedProvider } from '../stock/keys';
import { checkStockKey } from '../stock/providers';
import { archiveUserData } from '../storage/paths';
import { httpError } from '../util/fsx';
import { adminOf, clientIp, userOf } from './context';

function dto(r: UserRow): AdminUserDto {
  const linked = !!one('SELECT 1 AS x FROM immich_credentials WHERE user_id = ?', r.id);
  return toAdminDto(r, { locked: isLocked(userKey(r.username)), immichLinked: linked });
}

function target(id: string) {
  const u = findUserById(String(id));
  if (!u) throw httpError(404, 'User not found');
  return u;
}

function settingsDto(): ServerSettingsDto {
  const s = immichServerUrl();
  const tp = config.security.trustProxy;
  return {
    immichUrl: s.url,
    immichUrlFromEnv: s.source === 'env',
    allowRegistration: config.security.allowRegistration,
    trustProxy: Array.isArray(tp) ? tp.join(', ') : String(tp),
    https: config.security.https,
    stock: {
      pixabay: stockKeyStatus('pixabay'),
      unsplash: stockKeyStatus('unsplash'),
      openverse: { enabled: openverseEnabled(), fromEnv: config.stock.openverseFromEnv },
    },
  };
}

function keyedProvider(raw: string): KeyedProvider {
  if (!KEYED_PROVIDERS.includes(raw as KeyedProvider)) throw httpError(404, 'Unknown stock provider');
  return raw as KeyedProvider;
}

/** Refuse changes that would leave HomeCard without an active admin. */
function guardLastAdmin(u: UserRow, change: { role?: UserRole; disabled?: boolean; deleting?: boolean }) {
  const losesAdmin = u.role === 'admin' && !u.disabled && (change.deleting || change.disabled === true || (change.role && change.role !== 'admin'));
  if (losesAdmin && countActiveAdmins() <= 1) throw httpError(409, 'HomeCard needs at least one active admin. Make someone else an admin first.');
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req): Promise<AdminUserDto[]> => {
    adminOf(req);
    return listUserRows().map(dto);
  });

  app.post<{ Body: { username?: string; displayName?: string; password?: string; role?: UserRole } }>('/api/admin/users', async (req): Promise<AdminUserDto> => {
    const admin = adminOf(req);
    const username = normalizeUsername(req.body?.username);
    const displayName = String(req.body?.displayName ?? '').trim() || username;
    const password = String(req.body?.password ?? '');
    const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'user';
    const problem = usernameProblem(username) ?? displayNameProblem(displayName) ?? passwordProblem(password, username);
    if (problem) throw httpError(400, problem);
    if (findUserByUsername(username)) throw httpError(409, 'That username is taken.');
    // Temporary password: the new user must choose their own at first sign-in.
    const user = insertUser({ username, displayName, passwordHash: await hashPassword(password), role, mustChangePassword: true });
    audit({ event: 'user.created', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: user.username, role } });
    return dto(user);
  });

  app.put<{ Params: { id: string }; Body: { displayName?: string; role?: UserRole; disabled?: boolean } }>('/api/admin/users/:id', async (req): Promise<AdminUserDto> => {
    const admin = adminOf(req);
    const u = target(req.params.id);
    const b = req.body ?? {};
    const patch: { displayName?: string; role?: UserRole; disabled?: boolean } = {};
    if (typeof b.displayName === 'string') {
      const problem = displayNameProblem(b.displayName);
      if (problem) throw httpError(400, problem);
      patch.displayName = b.displayName;
    }
    if (b.role === 'admin' || b.role === 'user') patch.role = b.role;
    if (typeof b.disabled === 'boolean') patch.disabled = b.disabled;
    if (u.id === admin.userId && patch.disabled) throw httpError(409, 'You can’t disable your own account.');
    const updated = tx(() => {
      guardLastAdmin(u, patch);
      return updateUserFields(u.id, patch)!;
    });
    if (patch.disabled) {
      closeStreams({ sessionHashes: revokeUserSessions(u.id) });
      audit({ event: 'user.disabled', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username } });
    } else if (patch.disabled === false && u.disabled) {
      audit({ event: 'user.enabled', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username } });
    }
    if (patch.role && patch.role !== u.role) audit({ event: 'user.updated', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username, role: patch.role } });
    else if (patch.displayName && patch.displayName !== u.display_name) audit({ event: 'user.updated', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username, displayName: true } });
    return dto(updated);
  });

  /** Set a temporary password; the user must change it at next sign-in. Signs them out everywhere. */
  app.post<{ Params: { id: string }; Body: { password?: string } }>('/api/admin/users/:id/password', async (req): Promise<AdminUserDto> => {
    const admin = adminOf(req);
    const u = target(req.params.id);
    const password = String(req.body?.password ?? '');
    const problem = passwordProblem(password, u.username);
    if (problem) throw httpError(400, problem);
    setPasswordHash(u.id, await hashPassword(password), true);
    closeStreams({ sessionHashes: revokeUserSessions(u.id) });
    clearFailures(userKey(u.username));
    audit({ event: 'user.password_reset', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username } });
    return dto(findUserById(u.id)!);
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/unlock', async (req): Promise<AdminUserDto> => {
    const admin = adminOf(req);
    const u = target(req.params.id);
    clearFailures(userKey(u.username));
    audit({ event: 'user.unlocked', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username } });
    return dto(u);
  });

  /** Delete an account. Their cards, uploads and exports go to each folder's .trash for 30 days. */
  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const admin = adminOf(req);
    const u = target(req.params.id);
    if (u.id === admin.userId) throw httpError(409, 'You can’t delete your own account.');
    tx(() => guardLastAdmin(u, { deleting: true }));
    closeStreams({ sessionHashes: revokeUserSessions(u.id) });
    const moved = await archiveUserData(u.id);
    forgetUserExports(u.id);
    deleteUserRow(u.id); // cascades: sessions, Immich key, project/export ownership rows
    audit({ event: 'user.deleted', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { target: u.username, archived: moved } });
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string; before?: string; event?: string; userId?: string; outcome?: string } }>('/api/admin/audit', async (req) => {
    adminOf(req);
    const q = req.query;
    return listAudit({ limit: Number(q.limit ?? 100), before: q.before ? Number(q.before) : undefined, event: q.event || undefined, userId: q.userId || undefined, outcome: q.outcome || undefined });
  });

  app.get('/api/admin/settings', async (req): Promise<ServerSettingsDto> => {
    adminOf(req);
    return settingsDto();
  });

  app.put<{ Body: { immichUrl?: string; openverseEnabled?: boolean } }>('/api/admin/settings', async (req): Promise<ServerSettingsDto> => {
    const admin = adminOf(req);
    if (typeof req.body?.immichUrl === 'string') {
      const before = immichServerUrl().url;
      const after = setImmichServerUrl(req.body.immichUrl);
      if (after !== before) audit({ event: 'immich.url_changed', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { url: after } });
    }
    if (typeof req.body?.openverseEnabled === 'boolean' && req.body.openverseEnabled !== openverseEnabled()) {
      setOpenverseEnabled(req.body.openverseEnabled);
      audit({ event: 'stock.settings_changed', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { openverse: req.body.openverseEnabled } });
    }
    return settingsDto();
  });

  /**
   * Stock provider keys: checked with the provider, then stored encrypted. The key is never
   * echoed back, logged or written to the audit trail (only the provider and the outcome).
   */
  app.put<{ Params: { provider: string }; Body: { key?: string } }>('/api/admin/stock-keys/:provider', async (req): Promise<StockKeySaveResult> => {
    const admin = adminOf(req);
    const p = keyedProvider(req.params.provider);
    if (stockKeyStatus(p).source === 'env') setStockKey(p, ''); // throws the "set by environment" 409
    const key = normalizeStockKey(req.body?.key);
    const check = await checkStockKey(p, key);
    const who = { userId: admin.userId, username: admin.username, ip: clientIp(req) };
    if (check.valid === false) {
      audit({ event: 'stock.key_rejected', outcome: 'denied', ...who, detail: { provider: p } });
      throw httpError(400, check.message);
    }
    setStockKey(p, key);
    audit({ event: 'stock.key_saved', ...who, detail: { provider: p, verified: check.valid === true } });
    return { settings: settingsDto(), valid: check.valid, message: check.valid ? check.message : `${check.message} It was saved anyway; searches will show an error if it's wrong.` };
  });

  app.delete<{ Params: { provider: string } }>('/api/admin/stock-keys/:provider', async (req): Promise<ServerSettingsDto> => {
    const admin = adminOf(req);
    const p = keyedProvider(req.params.provider);
    setStockKey(p, '');
    audit({ event: 'stock.key_removed', userId: admin.userId, username: admin.username, ip: clientIp(req), detail: { provider: p } });
    return settingsDto();
  });

  /** Other active household members (for "Share copy with another user"). */
  app.get('/api/users/directory', async (req): Promise<UserDirectoryEntry[]> => {
    const me = userOf(req);
    return listUserRows()
      .filter((u) => !u.disabled && u.id !== me.userId)
      .map((u) => ({ id: u.id, username: u.username, displayName: u.display_name }));
  });
}
