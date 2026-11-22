import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Lock, Save, Trash2 } from 'lucide-react';
import type { ServerSettingsDto, StockKeySaveResult, StockKeyStatus } from '@homecard/shared';
import { Spinner, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { useUi } from '@/store/ui';

/** Admin → Server settings: the household's Immich address, stock image keys and read-outs of security settings. */
export function AdminServer() {
  const [s, setS] = useState<ServerSettingsDto | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ServerSettingsDto>('/api/admin/settings').then(
      (d) => {
        setS(d);
        setUrl(d.immichUrl);
      },
      (e) => setError(e.message),
    );
    void useAssets.getState().loadHealth(true);
  }, []);

  if (!s) return error ? <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div> : <Spinner />;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.put<ServerSettingsDto>('/api/admin/settings', { immichUrl: url.trim() });
      setS(d);
      setUrl(d.immichUrl);
      void useAssets.getState().loadHealth(true);
      useUi.getState().toast(d.immichUrl ? 'Immich server address saved.' : 'Immich server address cleared.', 'ok');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const Info = ({ ok, label, value, hint }: { ok: boolean | null; label: string; value: string; hint?: string }) => (
    <div className="flex items-start gap-2 py-1.5">
      {ok === null ? <span className="mt-0.5 h-4 w-4" /> : ok ? <CheckCircle2 size={16} className="mt-0.5 text-ok" /> : <AlertTriangle size={16} className="mt-0.5 text-warn" />}
      <div className="min-w-0">
        <div className="text-[13px]">
          <span className="font-medium">{label}:</span> <span className="font-mono text-[12px]">{value}</span>
        </div>
        {hint && <div className="text-[12px] text-ink-3">{hint}</div>}
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="font-display text-lg">Server settings</h3>
        <p className="text-[13px] text-ink-3">Settings for everyone on this HomeCard server.</p>
      </div>

      <div className="space-y-3 rounded-xl border border-line bg-white p-4">
        <div>
          <div className="text-[14px] font-medium">Immich server address</div>
          <p className="text-[12px] text-ink-3">
            Only admins can set this, so nobody can point HomeCard at other machines on your network. Each person then links their own read-only API key under Immich connection —
            there is no shared household key.
          </p>
        </div>
        {s.immichUrlFromEnv ? (
          <div className="flex items-start gap-2 rounded-lg bg-paper-2 px-3 py-2.5 text-[13px]">
            <Lock size={15} className="mt-0.5 text-ink-3" />
            <div>
              <code className="text-[12px]">{s.immichUrl}</code>
              <div className="text-[12px] text-ink-3">
                Set by the <code>IMMICH_URL</code> environment variable. Change it in your Docker settings and restart the container.
              </div>
            </div>
          </div>
        ) : (
          <>
            <input className="input" placeholder="http://192.168.1.20:2283" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            <div className="text-[11px] text-ink-3">The address the HomeCard container reaches Immich at (http or https, no /api suffix needed). Leave empty to turn Immich off.</div>
            {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
            <button className="btn btn-primary" onClick={save} disabled={busy || url.trim() === s.immichUrl}>
              {busy ? <Spinner size={13} className="text-white" /> : <Save size={14} />} Save address
            </button>
          </>
        )}
      </div>

      <div className="rounded-xl border border-line bg-white px-4 py-2">
        <div className="pb-1 pt-2 text-[14px] font-medium">Security</div>
        <Info
          ok={!s.allowRegistration}
          label="Open registration"
          value={s.allowRegistration ? 'on' : 'off'}
          hint={s.allowRegistration ? 'Anyone who can reach HomeCard can create an account. Set ALLOW_REGISTRATION=false to make it invite-only.' : 'Invite-only: admins create accounts under Users.'}
        />
        <Info
          ok={s.https ? true : null}
          label="HTTPS cookies"
          value={s.https ? 'Secure cookies always' : 'Secure cookies when the request arrives over HTTPS'}
          hint="Set HTTPS=true when HomeCard is only reached through an HTTPS reverse proxy."
        />
        <Info ok={null} label="Trusted proxy" value={s.trustProxy || 'none'} hint="TRUST_PROXY decides whose X-Forwarded-For / X-Forwarded-Proto headers are believed (for rate limiting and Secure cookies)." />
        <div className="pb-2 pt-1 text-[11px] text-ink-3">These come from environment variables; see .env.example.</div>
      </div>

      <StockSettings settings={s} onChange={setS} />
    </div>
  );
}

const KEYED = [
  {
    id: 'pixabay' as const,
    name: 'Pixabay',
    env: 'PIXABAY_API_KEY',
    getKeyUrl: 'https://pixabay.com/api/docs/',
    how: 'Free: sign in at pixabay.com, open the API documentation page and copy the key shown under “Parameters”.',
  },
  {
    id: 'unsplash' as const,
    name: 'Unsplash',
    env: 'UNSPLASH_API_KEY',
    getKeyUrl: 'https://unsplash.com/oauth/applications',
    how: 'Free: create an application at unsplash.com/developers and copy its “Access Key” (not the Secret key).',
  },
];

/** Stock backgrounds: Openverse on/off and the Pixabay / Unsplash keys (stored encrypted, never shown again). */
function StockSettings({ settings, onChange }: { settings: ServerSettingsDto; onChange: (s: ServerSettingsDto) => void }) {
  const toast = useUi((x) => x.toast);
  const [busy, setBusy] = useState(false);
  const refresh = (d: ServerSettingsDto) => {
    onChange(d);
    void useAssets.getState().loadHealth(true);
  };
  const ov = settings.stock.openverse;

  const setOpenverse = async (on: boolean) => {
    setBusy(true);
    try {
      refresh(await api.put<ServerSettingsDto>('/api/admin/settings', { openverseEnabled: on }));
      toast(on ? 'Openverse search is on.' : 'Openverse search is off.', 'ok');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-white p-4">
      <div>
        <div className="text-[14px] font-medium">Stock backgrounds</div>
        <p className="text-[12px] text-ink-3">
          Searches go through this server; the browser never talks to the stock sites directly (except Unsplash preview thumbnails, as Unsplash requires). Keys are stored
          encrypted and are never shown again after saving.
        </p>
      </div>

      <div className="rounded-lg border border-line px-3 py-2">
        {ov.fromEnv ? (
          <div className="flex items-start gap-2 text-[13px]">
            <Lock size={15} className="mt-0.5 text-ink-3" />
            <div>
              <span className="font-medium">Openverse:</span> {ov.enabled ? 'on' : 'off'}
              <div className="text-[12px] text-ink-3">
                Set by <code>OPENVERSE_ENABLED</code> in the container settings.
              </div>
            </div>
          </div>
        ) : (
          <Toggle
            checked={ov.enabled}
            onChange={(v) => {
              if (!busy) void setOpenverse(v);
            }}
            label="Openverse (no key needed)"
            hint="Public-domain and CC0 images only: free to print without asking anyone. Turn off for a server that never goes online."
          />
        )}
      </div>

      {KEYED.map((p) => (
        <StockKeyRow key={p.id} provider={p} status={settings.stock[p.id]} onChange={refresh} />
      ))}
    </div>
  );
}

function StockKeyRow({ provider, status, onChange }: { provider: (typeof KEYED)[number]; status: StockKeyStatus; onChange: (s: ServerSettingsDto) => void }) {
  const toast = useUi((x) => x.toast);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'remove'>('');
  const [error, setError] = useState('');
  const enabled = status.source !== 'none' && !status.unreadable;

  const save = async () => {
    setBusy('save');
    setError('');
    try {
      const r = await api.put<StockKeySaveResult>(`/api/admin/stock-keys/${provider.id}`, { key: key.trim() });
      setKey('');
      onChange(r.settings);
      toast(provider.id === 'unsplash' ? `${r.message} Reload open HomeCard pages to see Unsplash thumbnails.` : r.message, r.valid === null ? 'info' : 'ok');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    setBusy('remove');
    setError('');
    try {
      onChange(await api.del<ServerSettingsDto>(`/api/admin/stock-keys/${provider.id}`));
      toast(`${provider.name} key removed. ${provider.name} search is off.`, 'ok');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-line px-3 py-2.5">
      <div className="flex items-start gap-2">
        {enabled ? <CheckCircle2 size={16} className="mt-0.5 text-ok" /> : <AlertTriangle size={16} className="mt-0.5 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">
            <span className="font-medium">{provider.name}:</span>{' '}
            {status.unreadable ? (
              'saved key can’t be read'
            ) : enabled ? (
              <>
                on <span className="font-mono text-[12px] text-ink-3">key …{status.last4}</span>
              </>
            ) : (
              'off'
            )}
          </div>
          {status.unreadable && <div className="text-[12px] text-bad">The server’s encryption key changed since this was saved. Paste the key again.</div>}
        </div>
        {status.source === 'admin' && (
          <button className="btn btn-sm" onClick={remove} disabled={!!busy} title={`Remove the ${provider.name} key`}>
            {busy === 'remove' ? <Spinner size={12} /> : <Trash2 size={13} />} Remove
          </button>
        )}
      </div>

      {status.source === 'env' ? (
        <div className="flex items-start gap-2 rounded-lg bg-paper-2 px-3 py-2 text-[12px] text-ink-3">
          <Lock size={14} className="mt-0.5" />
          <div>
            Set by <code>{provider.env}</code> in the container settings. Remove it there to manage the key here instead.
          </div>
        </div>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim() && !busy) void save();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <KeyRound size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                className="input w-full pl-8 font-mono text-[12px]"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={enabled ? 'Paste a new key to replace it' : `Paste your ${provider.name} API key`}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label={`${provider.name} API key`}
              />
            </div>
            <button className="btn btn-primary shrink-0" type="submit" disabled={!key.trim() || !!busy}>
              {busy === 'save' ? <Spinner size={13} className="text-white" /> : <Save size={14} />} Check & save
            </button>
          </form>
          {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
          <div className="text-[11px] text-ink-3">
            {provider.how}{' '}
            <a className="inline-flex items-center gap-0.5 underline" href={provider.getKeyUrl} target="_blank" rel="noopener noreferrer">
              Get a key <ExternalLink size={10} />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
