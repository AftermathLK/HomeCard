import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthState, SessionUser } from '@homecard/shared';
import { api, ApiError } from '@/lib/api';

/**
 * The only page served to signed-out browsers: sign in, first-run admin setup, optional
 * self-registration, and the forced "choose your own password" step after an admin reset.
 */

type Mode = 'loading' | 'login' | 'setup' | 'register' | 'change' | 'error';

const MIN_PASSWORD = 10;

/** Same rule as the server: only same-site relative paths, never back to an auth page. */
function safeNext(v: string | null) {
  const s = v ?? '';
  return /^\/(?![\\/])[^\s]*$/.test(s) && !/^\/(login|setup|register)(\/|\?|$)/.test(s) ? s : '/';
}

function modeFor(state: AuthState, params: URLSearchParams): Mode {
  if (state.setupRequired) return 'setup';
  if (state.user?.mustChangePassword) return 'change';
  if (state.user && params.get('change') === '1') return 'change';
  if (location.pathname.startsWith('/register') && state.allowRegistration && !state.user) return 'register';
  return 'login';
}

export function AuthApp() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const next = safeNext(params.get('next'));
  const [state, setState] = useState<AuthState | null>(null);
  const [mode, setMode] = useState<Mode>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .get<AuthState>('/api/auth/state')
      .then((s) => {
        setState(s);
        setUser(s.user);
        const m = modeFor(s, params);
        // Already signed in with nothing to do here: go straight to the app.
        if (m === 'login' && s.user) return location.replace(next);
        const want = m === 'setup' ? '/setup' : m === 'register' ? '/register' : '/login';
        if (location.pathname !== want) history.replaceState(null, '', want + (m === 'change' ? '?change=1' : location.search));
        setMode(m);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setMode('error');
      });
  }, [params, next]);

  useEffect(() => {
    document.title = { loading: 'HomeCard', login: 'Sign in · HomeCard', setup: 'Set up HomeCard', register: 'Create account · HomeCard', change: 'Choose a new password · HomeCard', error: 'HomeCard' }[mode];
  }, [mode]);

  const done = (u: SessionUser) => {
    setUser(u);
    if (u.mustChangePassword) {
      history.replaceState(null, '', '/login?change=1');
      setMode('change');
    } else location.replace(next);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="h-11 w-11" />
          <div className="font-display text-[28px] leading-none text-ink">HomeCard</div>
          <div className="text-[13px] text-ink-3">Print-ready cards from your family photos</div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-card">
          {mode === 'loading' && <div className="py-8 text-center text-ink-3">Loading…</div>}
          {mode === 'error' && (
            <div className="space-y-3 text-center">
              <div className="font-medium text-bad">HomeCard isn’t responding.</div>
              <div className="text-[13px] text-ink-3">{loadError}</div>
              <button className="btn" onClick={() => location.reload()}>
                Try again
              </button>
            </div>
          )}
          {mode === 'login' && <LoginForm allowRegistration={!!state?.allowRegistration} onDone={done} />}
          {mode === 'setup' && <AccountForm kind="setup" onDone={done} />}
          {mode === 'register' && <AccountForm kind="register" onDone={done} />}
          {mode === 'change' && user && <ChangePasswordForm user={user} onDone={done} />}
        </div>
        <p className="mt-5 text-center text-[12px] text-ink-3">Private to your household. Every page needs a signed-in account.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Field(props: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{props.label}</span>
      {props.children}
      {props.hint && <span className="mt-1 block text-[12px] text-ink-3">{props.hint}</span>}
    </label>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">
      {children}
    </div>
  );
}

function errText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Could not reach HomeCard. Check your connection and try again.';
}

function LoginForm({ allowRegistration, onDone }: { allowRegistration: boolean; onDone: (u: SessionUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const lockLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/login', { username, password });
      onDone(r.user);
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError && err.code === 'locked') setLockedUntil(Date.now() + Number(err.data?.retryAfterSec ?? 900) * 1000);
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h1 className="text-[17px] font-semibold text-ink">Sign in</h1>
      <Field label="Username">
        <input className="input w-full" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />
      </Field>
      <Field label="Password">
        <input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {(error || lockLeft > 0) && (
        <ErrorNote>
          {error}
          {lockLeft > 0 && <span className="mt-1 block text-[12px]">You can try again in {lockLeft >= 60 ? `${Math.ceil(lockLeft / 60)} min` : `${lockLeft} s`}.</span>}
        </ErrorNote>
      )}
      <button className="btn btn-primary btn-lg w-full" disabled={busy || lockLeft > 0 || !username || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="text-center text-[12px] text-ink-3">
        {allowRegistration ? (
          <>
            New here?{' '}
            <a className="font-medium text-brand underline" href="/register">
              Create an account
            </a>
          </>
        ) : (
          'Need an account or forgot your password? Ask your HomeCard admin.'
        )}
      </div>
    </form>
  );
}

function PasswordPair(props: { value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void; username?: string; label?: string }) {
  const tooShort = props.value.length > 0 && props.value.length < MIN_PASSWORD;
  const hasName = !!props.username && props.username.length >= 3 && props.value.toLowerCase().includes(props.username.toLowerCase());
  const mismatch = props.confirm.length > 0 && props.confirm !== props.value;
  return (
    <>
      <Field
        label={props.label ?? 'Password'}
        hint={tooShort ? <span className="text-warn">At least {MIN_PASSWORD} characters ({props.value.length} so far).</span> : hasName ? <span className="text-warn">Don’t include the username.</span> : `At least ${MIN_PASSWORD} characters. A short phrase of a few words works well.`}
      >
        <input className="input w-full" type="password" autoComplete="new-password" value={props.value} onChange={(e) => props.onChange(e.target.value)} required minLength={MIN_PASSWORD} maxLength={256} />
      </Field>
      <Field label="Confirm password" hint={mismatch ? <span className="text-warn">The passwords don’t match.</span> : undefined}>
        <input className="input w-full" type="password" autoComplete="new-password" value={props.confirm} onChange={(e) => props.onConfirm(e.target.value)} required />
      </Field>
    </>
  );
}

const passwordOk = (p: string, c: string, username?: string) =>
  p.length >= MIN_PASSWORD && p === c && !(username && username.length >= 3 && p.toLowerCase().includes(username.toLowerCase()));

function AccountForm({ kind, onDone }: { kind: 'setup' | 'register'; onDone: (u: SessionUser) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uname = username.trim().toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: SessionUser }>(kind === 'setup' ? '/api/auth/setup' : '/api/auth/register', { username: uname, displayName: displayName.trim(), password });
      onDone(r.user);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <h1 className="text-[17px] font-semibold text-ink">{kind === 'setup' ? 'Create the admin account' : 'Create your account'}</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          {kind === 'setup'
            ? 'This is the first start. The admin adds everyone else in the household and manages the server settings. This page closes for good once the account exists.'
            : 'Your cards, uploads and Immich connection stay private to your account.'}
        </p>
      </div>
      <Field label="Username" hint="Lowercase letters, numbers, dots, dashes or underscores.">
        <input className="input w-full" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={32} />
      </Field>
      <Field label="Display name" hint="Shown in the app, for example “Alex” or “Grandma Rose”.">
        <input className="input w-full" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} placeholder={uname || undefined} />
      </Field>
      <PasswordPair value={password} confirm={confirm} onChange={setPassword} onConfirm={setConfirm} username={uname} />
      <ErrorNote>{error}</ErrorNote>
      <button className="btn btn-primary btn-lg w-full" disabled={busy || !uname || !passwordOk(password, confirm, uname)}>
        {busy ? 'Creating…' : kind === 'setup' ? 'Create admin and continue' : 'Create account'}
      </button>
      {kind === 'register' && (
        <div className="text-center text-[12px] text-ink-3">
          Already have an account?{' '}
          <a className="font-medium text-brand underline" href="/login">
            Sign in
          </a>
        </div>
      )}
    </form>
  );
}

function ChangePasswordForm({ user, onDone }: { user: SessionUser; onDone: (u: SessionUser) => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/password', { currentPassword: current, newPassword: password });
      onDone(r.user);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    location.replace('/login');
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <h1 className="text-[17px] font-semibold text-ink">Choose a new password</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          {user.mustChangePassword
            ? `Hi ${user.displayName}. You signed in with a temporary password from your admin. Pick your own to continue — nobody else will know it.`
            : 'Changing your password signs out your other devices.'}
        </p>
      </div>
      <input type="text" hidden readOnly autoComplete="username" value={user.username} />
      <Field label={user.mustChangePassword ? 'Temporary password' : 'Current password'}>
        <input className="input w-full" type="password" autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <PasswordPair value={password} confirm={confirm} onChange={setPassword} onConfirm={setConfirm} username={user.username} label="New password" />
      <ErrorNote>{error}</ErrorNote>
      <button className="btn btn-primary btn-lg w-full" disabled={busy || !current || !passwordOk(password, confirm, user.username)}>
        {busy ? 'Saving…' : 'Save password and continue'}
      </button>
      <div className="text-center text-[12px]">
        <button type="button" className="text-ink-3 underline" onClick={signOut}>
          Sign out instead
        </button>
      </div>
    </form>
  );
}
