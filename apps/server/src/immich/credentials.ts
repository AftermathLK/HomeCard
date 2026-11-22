import { analyzeImmichScopes, type ImmichConnectionDto, type ImmichKeyCheck } from '@homecard/shared';
import { config } from '../config';
import { getSetting, one, run, setSetting } from '../db';
import { audit } from '../security/audit';
import { open, seal } from '../security/keys';
import { httpError } from '../util/fsx';
import { ImmichWriteBlockedError, ReadOnlyImmichClient } from './readonly';

/**
 * Per-user Immich connections.
 *  - The Immich SERVER URL is a server-level setting (IMMICH_URL env, or an admin in Settings →
 *    Server). Regular users can't point HomeCard at arbitrary addresses (no SSRF into the LAN).
 *  - Each user saves their OWN read-only API key. It is encrypted with AES-256-GCM (key derived
 *    from APP_ENCRYPTION_KEY, user id as additional authenticated data) and never returned to the
 *    browser — only the last 4 characters, the verified scopes and the connection status.
 *  - The key used for any Immich request is looked up from the authenticated session's user id.
 */

/* ---------------- Server URL ---------------- */

export function normalizeImmichUrl(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw httpError(400, 'Enter the Immich address as a full URL, e.g. http://192.168.1.20:2283');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError(400, 'The Immich URL must start with http:// or https://');
  if (u.username || u.password) throw httpError(400, 'Don’t put a username or password in the Immich URL.');
  if (u.search || u.hash) throw httpError(400, 'The Immich URL can’t contain ? or #.');
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '').replace(/\/api$/, '');
}

export function immichServerUrl(): { url: string; source: 'env' | 'admin' | 'none' } {
  if (config.immich.url) return { url: normalizeImmichUrl(config.immich.url), source: 'env' };
  const s = getSetting('immich_url');
  return s ? { url: s, source: 'admin' } : { url: '', source: 'none' };
}

export function setImmichServerUrl(input: string): string {
  if (config.immich.url) throw httpError(409, 'The Immich URL is set by the IMMICH_URL environment variable. Change it there.');
  const url = normalizeImmichUrl(input);
  setSetting('immich_url', url || null);
  return url;
}

/* ---------------- Per-user keys ---------------- */

interface CredRow {
  user_id: string;
  key_iv: Uint8Array;
  key_ciphertext: Uint8Array;
  key_tag: Uint8Array;
  key_last4: string;
  permissions: string | null;
  scopes_verified: number;
  manual_ack: number;
  immich_user: string | null;
  verified_at: number | null;
  updated_at: number;
}

const credRow = (userId: string) => one<CredRow>('SELECT * FROM immich_credentials WHERE user_id = ?', userId);

/** Decrypt the user's key (server-side only). null when not linked or undecryptable. */
function loadUserKey(userId: string): string | null {
  const r = credRow(userId);
  if (!r) return null;
  try {
    return open({ iv: r.key_iv, ciphertext: r.key_ciphertext, tag: r.key_tag }, userId);
  } catch {
    return null;
  }
}

export function isLinked(userId: string) {
  return !!credRow(userId);
}

function blockedAuditor(userId: string) {
  return (reason: string) => audit({ event: 'immich.blocked_request', outcome: 'denied', userId, detail: { reason } });
}

/** Read-only client for the signed-in user's own Immich account. */
export function clientForUser(userId: string): ReadOnlyImmichClient {
  const { url } = immichServerUrl();
  if (!url) throw httpError(409, 'Immich isn’t set up on this HomeCard server yet. Ask your admin to add the Immich URL (Settings → Server).');
  const r = credRow(userId);
  if (!r) throw httpError(409, 'Connect your Immich account first: Settings → Immich connection.');
  const key = loadUserKey(userId);
  if (!key) throw httpError(409, 'Your saved Immich key can no longer be read (the server’s encryption key changed). Please enter it again under Settings → Immich connection.');
  return new ReadOnlyImmichClient(url, key, { onBlocked: blockedAuditor(userId) });
}

export function connectionDto(userId: string): ImmichConnectionDto {
  const server = immichServerUrl();
  const r = credRow(userId);
  const perms = r?.permissions ? (JSON.parse(r.permissions) as string[]) : null;
  const a = perms ? analyzeImmichScopes(perms) : null;
  return {
    serverUrl: server.url,
    serverConfigured: !!server.url,
    linked: !!r,
    keyLast4: r?.key_last4 ?? null,
    permissions: perms,
    scopesVerified: !!r?.scopes_verified,
    manualAck: !!r?.manual_ack,
    missingRequired: a?.missingRequired ?? [],
    missingOptional: a?.missingOptional ?? [],
    immichUser: r?.immich_user ?? null,
    verifiedAt: r?.verified_at ? new Date(r.verified_at).toISOString() : null,
    needsReentry: !!r && loadUserKey(userId) === null,
  };
}

/**
 * Layer 2: inspect the key's permissions with GET /api/api-keys/me and decide whether it may be
 * saved. Keys with any write/delete/admin/upload permission (or "all") are refused.
 */
export async function verifyImmichKey(url: string, apiKey: string, userId?: string): Promise<ImmichKeyCheck> {
  const out: ImmichKeyCheck = { reachable: false, authenticated: false, canSave: false, permissions: null, scopesVerifiable: false, dangerous: [], missingRequired: [], missingOptional: [] };
  if (!url) return { ...out, error: 'Immich isn’t set up on this server yet. Ask your admin to add the Immich URL.' };
  if (!/^[\x21-\x7e]{16,200}$/.test(apiKey)) return { ...out, error: 'That doesn’t look like an Immich API key. Copy the whole key Immich showed when you created it.' };
  const c = new ReadOnlyImmichClient(url, apiKey, { onBlocked: userId ? blockedAuditor(userId) : undefined });
  try {
    const ping = await c.probe('/api/server/ping');
    if (ping.status !== 200 || ping.body?.res !== 'pong') return { ...out, error: `${url} didn’t answer like an Immich server (HTTP ${ping.status}).` };
    out.reachable = true;

    const me = await c.probe('/api/api-keys/me');
    if (me.status === 401) return { ...out, error: 'Immich rejected this API key. Check you copied all of it, or create a new one.' };
    if (me.status === 200 && Array.isArray(me.body?.permissions)) {
      out.authenticated = true;
      out.scopesVerifiable = true;
      out.permissions = (me.body.permissions as unknown[]).map(String);
      const a = analyzeImmichScopes(out.permissions);
      out.dangerous = a.dangerous;
      out.missingRequired = a.missingRequired;
      out.missingOptional = a.missingOptional;
    } else {
      // Older Immich (no /api/api-keys/me) or the key lacks apiKey.read: confirm the key works at all.
      const probe = await c.probe('/api/albums');
      if (probe.status === 401) return { ...out, error: 'Immich rejected this API key. Check you copied all of it, or create a new one.' };
      out.authenticated = true;
      out.warning =
        me.status === 403
          ? 'Immich didn’t let HomeCard read this key’s permissions because it lacks apiKey.read. Add apiKey.read so HomeCard can verify the key is read-only — or check the permissions yourself and confirm below.'
          : 'This Immich server doesn’t report API key permissions (older version). Check in Immich that the key has only the read permissions listed below, then confirm.';
    }
    const user = await c.probe('/api/users/me');
    if (user.status === 200) out.immichUser = String(user.body?.name || user.body?.email || '') || undefined;
  } catch (e: any) {
    if (e instanceof ImmichWriteBlockedError) throw e;
    return { ...out, error: e?.message ?? String(e) };
  }
  if (out.dangerous.length) {
    out.error = `This key can change or delete things in Immich (${out.dangerous.join(', ')}). HomeCard only accepts read-only keys — create a new key with just the read permissions listed below.`;
    return out;
  }
  out.canSave = out.authenticated && out.scopesVerifiable;
  return out;
}

export async function saveUserKey(userId: string, apiKey: string, manualAck: boolean): Promise<{ check: ImmichKeyCheck; saved: boolean }> {
  const { url } = immichServerUrl();
  const key = apiKey.trim();
  const check = await verifyImmichKey(url, key, userId);
  if (!check.authenticated || check.dangerous.length) return { check, saved: false };
  if (!check.scopesVerifiable && !manualAck) return { check, saved: false };
  const s = seal(key, userId);
  run(
    `INSERT INTO immich_credentials(user_id, key_iv, key_ciphertext, key_tag, key_last4, permissions, scopes_verified, manual_ack, immich_user, verified_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET key_iv = excluded.key_iv, key_ciphertext = excluded.key_ciphertext, key_tag = excluded.key_tag,
       key_last4 = excluded.key_last4, permissions = excluded.permissions, scopes_verified = excluded.scopes_verified,
       manual_ack = excluded.manual_ack, immich_user = excluded.immich_user, verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
    userId,
    s.iv,
    s.ciphertext,
    s.tag,
    key.slice(-4),
    check.permissions ? JSON.stringify(check.permissions) : null,
    check.scopesVerifiable ? 1 : 0,
    check.scopesVerifiable ? 0 : 1,
    check.immichUser ?? null,
    Date.now(),
    Date.now(),
  );
  return { check: { ...check, canSave: true }, saved: true };
}

/** Re-check the stored key (Test button without typing a new key). */
export async function verifyStoredKey(userId: string): Promise<ImmichKeyCheck> {
  const key = loadUserKey(userId);
  const { url } = immichServerUrl();
  if (!key) return { reachable: false, authenticated: false, canSave: false, permissions: null, scopesVerifiable: false, dangerous: [], missingRequired: [], missingOptional: [], error: 'No Immich key saved yet.' };
  const check = await verifyImmichKey(url, key, userId);
  if (check.authenticated) {
    run(
      'UPDATE immich_credentials SET permissions = ?, scopes_verified = ?, immich_user = COALESCE(?, immich_user), verified_at = ? WHERE user_id = ?',
      check.permissions ? JSON.stringify(check.permissions) : null,
      check.scopesVerifiable && !check.dangerous.length ? 1 : 0,
      check.immichUser ?? null,
      Date.now(),
      userId,
    );
  }
  return check;
}

export function deleteUserKey(userId: string) {
  run('DELETE FROM immich_credentials WHERE user_id = ?', userId);
}
