import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import type { AuditEntryDto } from '@homecard/shared';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

const PAGE = 100;

const FILTERS: Array<{ id: string; label: string; event?: string; outcome?: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'signin', label: 'Sign-ins', event: 'auth.' },
  { id: 'failed', label: 'Denied / failed', outcome: 'denied' },
  { id: 'immich', label: 'Immich', event: 'immich.' },
  { id: 'users', label: 'User changes', event: 'user.' },
  { id: 'exports', label: 'Exports', event: 'export.' },
];

const LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Sign-in failed',
  'auth.locked_out': 'Locked out after failed sign-ins',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'auth.registered': 'Registered',
  'auth.setup': 'Created the first admin',
  'export.created': 'Export started',
  'export.deleted': 'Export deleted',
  'immich.blocked_request': 'Blocked a non-read-only Immich request',
  'immich.key_rejected': 'Immich key refused',
  'immich.key_removed': 'Immich key removed',
  'immich.key_saved': 'Immich key saved',
  'immich.key_tested': 'Immich key checked',
  'immich.url_changed': 'Immich server address changed',
  'project.shared': 'Shared a card copy',
  'security.csrf_rejected': 'Request without a valid CSRF token rejected',
  'setup.legacy_adopted': 'Imported data from a single-user install',
  'stock.saved': 'Saved a stock background',
  'styles.imported': 'Imported a style pack',
  'styles.uploaded': 'Uploaded style assets',
  'user.created': 'Created a user',
  'user.deleted': 'Deleted a user',
  'user.disabled': 'Disabled a user',
  'user.enabled': 'Enabled a user',
  'user.password_reset': 'Reset a password',
  'user.unlocked': 'Unlocked a user',
  'user.updated': 'Updated a user',
};

function detailText(d: Record<string, unknown> | null) {
  if (!d) return '';
  return Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export function AdminAudit() {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState<AuditEntryDto[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const query = useCallback(
    (before?: number) => {
      const f = FILTERS.find((x) => x.id === filter)!;
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (f.event) q.set('event', f.event);
      if (f.outcome) q.set('outcome', f.outcome);
      if (before) q.set('before', String(before));
      return api.get<AuditEntryDto[]>(`/api/admin/audit?${q}`);
    },
    [filter],
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await query();
      setRows(r);
      setMore(r.length === PAGE);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const older = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const r = await query(rows[rows.length - 1].id);
      setRows([...rows, ...r]);
      setMore(r.length === PAGE);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-display text-lg">Security log</h3>
          <p className="text-[13px] text-ink-3">Sign-ins, failed attempts, lockouts, Immich key changes, user management and exports. Entries are kept for a year.</p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={busy}>
          {busy ? <Spinner size={13} /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id} className={clsx('chip', filter === f.id && 'chip-on')} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
      {!rows ? (
        <Spinner />
      ) : !rows.length ? (
        <p className="text-[13px] text-ink-3">Nothing logged yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-paper-2/70 text-[11px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">What</th>
                <th className="px-3 py-2 font-semibold">Who</th>
                <th className="px-3 py-2 font-semibold">From</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-ink-3" title={r.at}>
                    {new Date(r.at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className={clsx('font-medium', r.outcome === 'denied' ? 'text-bad' : r.outcome === 'error' ? 'text-warn' : 'text-ink')}>
                      {LABELS[r.event] ?? r.event}
                      {r.outcome !== 'ok' && <span className="ml-1.5 rounded bg-paper-2 px-1 py-px text-[10px] uppercase tracking-wide">{r.outcome}</span>}
                    </div>
                    {r.detail && <div className="mt-0.5 break-words text-[11px] text-ink-3">{detailText(r.detail)}</div>}
                  </td>
                  <td className="px-3 py-2">{r.username ?? <span className="text-ink-3">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink-3">{r.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <button className="btn" onClick={older} disabled={busy}>
          Load older entries
        </button>
      )}
    </div>
  );
}
