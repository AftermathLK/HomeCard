import type { AuditEntryDto } from '@homecard/shared';
import { all, run } from '../db';

/**
 * Security audit log (admins: Settings → Audit log). Records who did what from where — never
 * passwords, API keys, tokens or photo content.
 */

export type AuditEvent =
  | 'auth.setup'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.locked_out'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'auth.registered'
  | 'security.csrf_rejected'
  | 'user.created'
  | 'user.updated'
  | 'user.password_reset'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.deleted'
  | 'user.unlocked'
  | 'immich.url_changed'
  | 'immich.key_saved'
  | 'immich.key_rejected'
  | 'immich.key_removed'
  | 'immich.key_tested'
  | 'immich.blocked_request'
  | 'export.created'
  | 'export.deleted'
  | 'project.shared'
  | 'project.deleted'
  | 'stock.saved'
  | 'stock.key_saved'
  | 'stock.key_rejected'
  | 'stock.key_removed'
  | 'stock.settings_changed'
  | 'fonts.uploaded'
  | 'styles.uploaded'
  | 'styles.imported'
  | 'setup.legacy_adopted';

export interface AuditInput {
  event: AuditEvent;
  outcome?: 'ok' | 'denied' | 'error';
  userId?: string | null;
  username?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown> | null;
}

const RETAIN_DAYS = 365;
const MAX_ROWS = 100_000;

export function audit(e: AuditInput) {
  try {
    run(
      'INSERT INTO audit_log(at, event, outcome, user_id, username, ip, detail) VALUES(?, ?, ?, ?, ?, ?, ?)',
      Date.now(),
      e.event,
      e.outcome ?? 'ok',
      e.userId ?? null,
      e.username ?? null,
      e.ip ?? null,
      e.detail ? JSON.stringify(e.detail).slice(0, 2000) : null,
    );
  } catch (err) {
    console.error('[audit] write failed', err);
  }
}

export function listAudit(q: { limit?: number; before?: number; event?: string; userId?: string; outcome?: string }): AuditEntryDto[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.before) {
    where.push('id < ?');
    params.push(q.before);
  }
  if (q.event) {
    where.push('event LIKE ?');
    params.push(`${q.event.replace(/[%_]/g, '')}%`);
  }
  if (q.userId) {
    where.push('user_id = ?');
    params.push(q.userId);
  }
  if (q.outcome) {
    where.push('outcome = ?');
    params.push(q.outcome);
  }
  const limit = Math.min(500, Math.max(1, q.limit ?? 100));
  const rows = all<{ id: number; at: number; event: string; outcome: string; user_id: string | null; username: string | null; ip: string | null; detail: string | null }>(
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`,
    ...params,
  );
  return rows.map((r) => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    event: r.event,
    outcome: r.outcome as AuditEntryDto['outcome'],
    userId: r.user_id,
    username: r.username,
    ip: r.ip,
    detail: r.detail ? safeParse(r.detail) : null,
  }));
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

export function pruneAudit() {
  run('DELETE FROM audit_log WHERE at < ?', Date.now() - RETAIN_DAYS * 86_400_000);
  run(`DELETE FROM audit_log WHERE id <= (SELECT id FROM audit_log ORDER BY id DESC LIMIT 1 OFFSET ${MAX_ROWS})`);
}
