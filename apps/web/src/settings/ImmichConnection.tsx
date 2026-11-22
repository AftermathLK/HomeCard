import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Lock, PlugZap, ShieldAlert, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { IMMICH_OPTIONAL_SCOPES, IMMICH_REQUIRED_SCOPES, type ImmichConnectionDto, type ImmichKeyCheck } from '@homecard/shared';
import { Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';

/**
 * Profile → Immich connection. Each person links their OWN Immich account with a read-only API
 * key. The server checks the key's permissions (GET /api/api-keys/me) and refuses any key that
 * could change or delete photos. The key itself never comes back to the browser.
 */
export function ImmichConnection() {
  const [conn, setConn] = useState<ImmichConnectionDto | null>(null);
  const [key, setKey] = useState('');
  const [check, setCheck] = useState<ImmichKeyCheck | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<'test' | 'save' | 'retest' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [guide, setGuide] = useState(false);
  const isAdmin = useSession((s) => s.user?.role === 'admin');

  const load = () => api.get<ImmichConnectionDto>('/api/me/immich').then(setConn, (e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (conn && !conn.linked) setGuide(true);
  }, [conn]);

  if (!conn) return error ? <ErrorBox>{error}</ErrorBox> : <Spinner />;

  const refreshApp = () => void useAssets.getState().loadHealth(true);

  const test = async () => {
    setBusy('test');
    setError('');
    try {
      setCheck(await api.post<ImmichKeyCheck>('/api/me/immich/test', { apiKey: key.trim() }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError('');
    try {
      const r = await api.put<{ check: ImmichKeyCheck; connection: ImmichConnectionDto }>('/api/me/immich', { apiKey: key.trim(), acknowledgeManualScopes: ack });
      setConn(r.connection);
      setCheck(r.check);
      setKey('');
      setAck(false);
      setGuide(false);
      refreshApp();
      useUi.getState().toast('Immich linked (read-only).', 'ok');
    } catch (e) {
      if (e instanceof ApiError && e.data?.check) setCheck(e.data.check as ImmichKeyCheck);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const retest = async () => {
    setBusy('retest');
    setError('');
    try {
      const c = await api.post<ImmichKeyCheck>('/api/me/immich/test', {});
      setCheck(c);
      await load();
      refreshApp();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm('Unlink Immich? HomeCard forgets your API key. Photos already placed on cards stay where they are. You may also want to delete the key in Immich.')) return;
    setBusy('remove');
    try {
      setConn(await api.del<ImmichConnectionDto>('/api/me/immich'));
      setCheck(null);
      refreshApp();
      useUi.getState().toast('Immich unlinked.', 'ok');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const needsAck = !!check && check.authenticated && !check.scopesVerifiable && check.dangerous.length === 0;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h3 className="font-display text-lg">Immich connection</h3>
        <p className="text-[13px] text-ink-3">
          Link <b>your own</b> Immich account so you can pick from your albums, people and favorites. Nobody else in the household can see your library through HomeCard, and HomeCard can
          only ever <b>read</b> from Immich — it can’t upload, edit or delete anything.
        </p>
      </div>

      {!conn.serverConfigured ? (
        <div className="rounded-xl border border-line bg-paper-2 px-4 py-3 text-[13px] text-ink-2">
          {isAdmin ? (
            <>
              No Immich server is set yet.{' '}
              <button className="font-medium text-brand underline" onClick={() => useUi.getState().openSettings('server')}>
                Add its address in Server settings
              </button>{' '}
              first.
            </>
          ) : (
            'Your HomeCard admin hasn’t set up the Immich server address yet. Once they do, you can link your account here.'
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className="text-ink-3">Server:</span>
          <code className="rounded bg-paper-2 px-1.5 py-0.5 text-[12px]">{conn.serverUrl}</code>
          <span className="text-[11px] text-ink-3">(set by your admin)</span>
        </div>
      )}

      {conn.linked && <LinkedStatus conn={conn} busy={busy} onRetest={retest} onRemove={remove} />}

      {conn.serverConfigured && (
        <div className="space-y-3 rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-brand" />
            <div className="flex-1 text-[14px] font-medium">{conn.linked ? 'Replace your API key' : 'Link your Immich account'}</div>
            <button className="text-[12px] font-medium text-brand underline" onClick={() => setGuide((v) => !v)}>
              {guide ? 'Hide' : 'Show'} how to create a read-only key
            </button>
          </div>
          {guide && <KeyGuide serverUrl={conn.serverUrl} />}
          <label className="block">
            <span className="label">Your Immich API key</span>
            <input
              className="input font-mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste the key Immich showed you"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setCheck(null);
                setAck(false);
                setError('');
              }}
            />
            <span className="mt-1 block text-[11px] text-ink-3">Stored encrypted (AES-256-GCM) on the server. It is never shown again — only its last 4 characters.</span>
          </label>
          {check && <CheckResult check={check} />}
          {needsAck && (
            <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-[13px] text-ink">
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                I checked in Immich that this key has <b>only</b> the read permissions listed above (no “all”, create, update, delete, upload or admin permissions).
              </span>
            </label>
          )}
          {error && !check && <ErrorBox>{error}</ErrorBox>}
          {error && check && !check.canSave && check.dangerous.length === 0 && !needsAck && <ErrorBox>{error}</ErrorBox>}
          <div className="flex gap-2">
            <button className="btn" onClick={test} disabled={busy !== null || key.trim().length < 16}>
              {busy === 'test' ? <Spinner size={14} /> : <PlugZap size={15} />} Check key
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={busy !== null || key.trim().length < 16 || (check !== null && check.dangerous.length > 0) || (needsAck && !ack)}
              title={check?.dangerous.length ? 'This key can change your library. Create a read-only key instead.' : undefined}
            >
              {busy === 'save' ? <Spinner size={14} className="text-white" /> : <ShieldCheck size={15} />} Save read-only key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkedStatus({ conn, busy, onRetest, onRemove }: { conn: ImmichConnectionDto; busy: string | null; onRetest: () => void; onRemove: () => void }) {
  const tone = conn.needsReentry ? 'bad' : conn.scopesVerified ? 'ok' : 'warn';
  return (
    <div className={clsx('rounded-xl border px-4 py-3 text-[13px]', tone === 'ok' ? 'border-ok/30 bg-ok-soft' : tone === 'warn' ? 'border-warn/30 bg-warn-soft' : 'border-bad/30 bg-bad-soft')}>
      <div className="flex items-start gap-2">
        {tone === 'ok' ? <ShieldCheck size={17} className="mt-0.5 text-ok" /> : tone === 'warn' ? <ShieldAlert size={17} className="mt-0.5 text-warn" /> : <XCircle size={17} className="mt-0.5 text-bad" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">
            {conn.needsReentry ? 'Your saved key can’t be read any more' : `Linked${conn.immichUser ? ` as ${conn.immichUser}` : ''}`}
            <span className="ml-2 font-mono text-[12px] font-normal text-ink-3">key ••••{conn.keyLast4}</span>
          </div>
          <div className="mt-0.5 text-ink-2">
            {conn.needsReentry
              ? 'The server’s encryption key changed since you saved it. Paste your Immich API key again below.'
              : conn.scopesVerified
                ? 'Immich confirmed this key is read-only.'
                : 'Your Immich server doesn’t report key permissions, so you confirmed them by hand. HomeCard still blocks every write request on its side.'}
            {conn.verifiedAt && <span className="text-ink-3"> · Checked {new Date(conn.verifiedAt).toLocaleString()}</span>}
          </div>
          {conn.permissions && (
            <div className="mt-2 flex flex-wrap gap-1">
              {conn.permissions.map((p) => (
                <span key={p} className="rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {p}
                </span>
              ))}
            </div>
          )}
          {conn.missingRequired.length > 0 && (
            <div className="mt-2 text-[12px] text-warn">Some features won’t work — the key is missing: {conn.missingRequired.join(', ')}.</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {!conn.needsReentry && (
            <button className="btn btn-sm" onClick={onRetest} disabled={busy !== null}>
              {busy === 'retest' ? <Spinner size={12} /> : <PlugZap size={13} />} Re-check
            </button>
          )}
          <button className="btn btn-sm" onClick={onRemove} disabled={busy !== null}>
            <Trash2 size={13} /> Unlink
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckResult({ check }: { check: ImmichKeyCheck }) {
  if (!check.reachable || !check.authenticated) {
    return (
      <ErrorBox>
        {check.error ?? (check.reachable ? 'Immich didn’t accept this key.' : 'Couldn’t reach the Immich server.')}
      </ErrorBox>
    );
  }
  if (check.dangerous.length) {
    return (
      <div role="alert" className="rounded-lg border border-bad/40 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">
        <div className="flex items-center gap-1.5 font-semibold">
          <Lock size={15} /> This key can change your photo library — HomeCard won’t save it.
        </div>
        <p className="mt-1 text-ink-2">
          Only read-only keys are allowed, so HomeCard can never delete or modify anything in Immich. The key has these permissions that go beyond reading:
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {check.dangerous.map((p) => (
            <span key={p} className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-bad">
              {p}
            </span>
          ))}
        </div>
        <p className="mt-2 text-ink-2">Delete this key in Immich and create a new one with only the permissions in the checklist.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
        <CheckCircle2 size={15} /> Immich accepted the key{check.immichUser ? ` for ${check.immichUser}` : ''}.
        {check.scopesVerifiable && ' It is read-only.'}
      </div>
      {!check.scopesVerifiable && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-[13px] text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <div className="font-medium">HomeCard couldn’t verify this key’s permissions.</div>
            <div className="mt-0.5 text-ink-2">
              {check.warning ??
                'Your Immich server is older or the key lacks apiKey.read, so it didn’t report what the key may do.'}{' '}
              Open the key in Immich and make sure it has only the read permissions in the checklist. HomeCard still refuses to send any write request to Immich either way.
            </div>
          </div>
        </div>
      )}
      {check.missingRequired.length > 0 && check.scopesVerifiable && (
        <div className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">
          Missing permissions (some features won’t work): <span className="font-mono">{check.missingRequired.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function KeyGuide({ serverUrl }: { serverUrl: string }) {
  const keysUrl = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/user-settings?isOpen=api-keys` : '';
  return (
    <div className="rounded-lg bg-paper-2 px-4 py-3 text-[13px]">
      <ol className="list-decimal space-y-1.5 pl-5 text-ink-2">
        <li>
          Open Immich and go to <b>Account Settings → API Keys → New API Key</b>
          {keysUrl && (
            <>
              {' '}
              (
              <a className="inline-flex items-center gap-0.5 font-medium text-brand underline" href={keysUrl} target="_blank" rel="noopener noreferrer">
                open <ExternalLink size={11} />
              </a>
              )
            </>
          )}
          .
        </li>
        <li>Name it “HomeCard (read-only)”. Leave “all” <b>unticked</b>.</li>
        <li>
          Tick <b>only</b> these permissions:
          <ul className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {IMMICH_REQUIRED_SCOPES.map((s) => (
              <li key={s.id} className="flex items-start gap-1.5">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                <span>
                  <code className="text-[12px] text-ink">{s.label}</code> <span className="text-[12px] text-ink-3">— {s.why}</span>
                </span>
              </li>
            ))}
            {IMMICH_OPTIONAL_SCOPES.map((s) => (
              <li key={s.id} className="flex items-start gap-1.5">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ink-3" />
                <span>
                  <code className="text-[12px] text-ink">{s.label}</code> <span className="text-[12px] text-ink-3">— {s.why}</span>
                </span>
              </li>
            ))}
          </ul>
        </li>
        <li>Create the key, copy it, and paste it below. Immich shows it only once.</li>
      </ol>
      <p className="mt-2 text-[12px] text-ink-3">
        HomeCard refuses keys with “all”, any create/update/delete permission, upload or admin rights. <code>apiKey.read</code> lets HomeCard confirm that for you.
      </p>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-1.5 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{children}</span>
    </div>
  );
}
