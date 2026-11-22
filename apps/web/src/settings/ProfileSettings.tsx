import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SessionUser } from '@homecard/shared';
import { Spinner } from '@/components/ui';
import { initials } from '@/components/UserMenu';
import { api } from '@/lib/api';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';

const MIN_PASSWORD = 10;

export function ProfileSettings() {
  const user = useSession((s) => s.user)!;
  const [name, setName] = useState(user.displayName);
  const [savingName, setSavingName] = useState(false);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    try {
      useSession.getState().setUser(await api.put<SessionUser>('/api/auth/me', { displayName: name.trim() }));
      useUi.getState().toast('Display name saved.', 'ok');
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-[16px] font-semibold text-white">{initials(user.displayName)}</span>
        <div>
          <h3 className="font-display text-lg leading-tight">{user.displayName}</h3>
          <div className="text-[13px] text-ink-3">
            @{user.username} · {user.role === 'admin' ? 'Admin' : 'Member'}
          </div>
        </div>
      </div>

      <form className="space-y-2" onSubmit={saveName}>
        <label className="block">
          <span className="label">Display name</span>
          <div className="flex gap-2">
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={savingName || !name.trim() || name.trim() === user.displayName}>
              {savingName && <Spinner size={13} />} Save
            </button>
          </div>
          <span className="mt-1 block text-[11px] text-ink-3">Shown to others when you share a card copy with them.</span>
        </label>
      </form>

      <ChangePassword user={user} />

      <div className="rounded-xl border border-line bg-paper-2/60 px-4 py-3 text-[12px] leading-relaxed text-ink-2">
        Your cards, uploaded photos, exports and Immich connection are private to your account. Admins manage accounts but can’t open your cards or see your Immich
        library from inside HomeCard.
      </div>
    </div>
  );
}

function ChangePassword({ user }: { user: SessionUser }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const hasName = user.username.length >= 3 && next.toLowerCase().includes(user.username.toLowerCase());
  const ok = current && next.length >= MIN_PASSWORD && next === confirm && !hasName;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/password', { currentPassword: current, newPassword: next });
      useSession.getState().setUser(r.user);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-3 rounded-xl border border-line bg-white p-4" onSubmit={submit}>
      <div>
        <div className="text-[14px] font-medium">Change password</div>
        <div className="text-[12px] text-ink-3">Signs you out on every other device.</div>
      </div>
      <input type="text" hidden readOnly autoComplete="username" value={user.username} />
      <label className="block">
        <span className="label">Current password</span>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">New password</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Confirm</span>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      </div>
      <div className="text-[11px] text-ink-3">
        {next && next.length < MIN_PASSWORD ? (
          <span className="text-warn">At least {MIN_PASSWORD} characters.</span>
        ) : hasName ? (
          <span className="text-warn">Don’t include your username.</span>
        ) : confirm && confirm !== next ? (
          <span className="text-warn">The passwords don’t match.</span>
        ) : (
          `At least ${MIN_PASSWORD} characters. A short phrase of a few words works well.`
        )}
      </div>
      {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
      {done && (
        <div className="flex items-center gap-1.5 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
          <CheckCircle2 size={14} /> Password changed. Other devices were signed out.
        </div>
      )}
      <button className="btn btn-primary" disabled={!ok || busy}>
        {busy && <Spinner size={13} className="text-white" />} Change password
      </button>
    </form>
  );
}
