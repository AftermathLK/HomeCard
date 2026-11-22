import { useEffect, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { Copy, KeyRound, Lock, Pencil, RefreshCw, ShieldCheck, Trash2, Unlock, UserPlus, UserX } from 'lucide-react';
import type { AdminUserDto, UserRole } from '@homecard/shared';
import { Modal, Spinner } from '@/components/ui';
import { api, enc } from '@/lib/api';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';

/** Readable random temporary password, e.g. "kfp7-wq3m-zt9h-c2rx" (no look-alike characters). */
export function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

const toast = (t: string, k: 'ok' | 'error' | 'info' = 'ok') => useUi.getState().toast(t, k);

export function AdminUsers() {
  const me = useSession((s) => s.user)!;
  const [users, setUsers] = useState<AdminUserDto[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserDto | null>(null);
  const [deleting, setDeleting] = useState<AdminUserDto | null>(null);
  const [issued, setIssued] = useState<{ user: AdminUserDto; password: string; created: boolean } | null>(null);

  const load = () => api.get<AdminUserDto[]>('/api/admin/users').then(setUsers, (e) => toast(e.message, 'error'));
  useEffect(() => {
    void load();
  }, []);

  const patch = async (u: AdminUserDto, body: Partial<{ displayName: string; role: UserRole; disabled: boolean }>, msg: string) => {
    try {
      await api.put<AdminUserDto>(`/api/admin/users/${enc(u.id)}`, body);
      toast(msg);
      await load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const unlock = async (u: AdminUserDto) => {
    try {
      await api.post(`/api/admin/users/${enc(u.id)}/unlock`);
      toast(`${u.displayName} can sign in again.`);
      await load();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-display text-lg">Users</h3>
          <p className="text-[13px] text-ink-3">
            HomeCard is invite-only: add each household member here with a temporary password. They choose their own password at first sign-in, and each person links their own
            Immich account.
          </p>
        </div>
        <button className="btn" onClick={() => void load()} title="Refresh">
          <RefreshCw size={14} />
        </button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <UserPlus size={15} /> Add user
        </button>
      </div>

      {!users ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-paper-2/70 text-[11px] uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-3 py-2 font-semibold">Person</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Last sign-in</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={clsx('border-t border-line align-top', u.disabled && 'bg-paper-2/40 text-ink-3')}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">
                      {u.displayName} {u.id === me.id && <span className="text-[11px] font-normal text-ink-3">(you)</span>}
                    </div>
                    <div className="text-[12px] text-ink-3">@{u.username}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.role === 'admin' ? (
                      <span className="chip !gap-1 !border-brand/30 !bg-brand-soft !text-brand">
                        <ShieldCheck size={12} /> Admin
                      </span>
                    ) : (
                      <span className="chip">Member</span>
                    )}
                  </td>
                  <td className="space-y-0.5 px-3 py-2.5 text-[12px]">
                    {u.disabled ? <div className="font-medium text-bad">Disabled</div> : <div className="text-ok">Active</div>}
                    {u.locked && (
                      <div className="flex items-center gap-1 text-warn">
                        <Lock size={11} /> Locked (failed sign-ins)
                      </div>
                    )}
                    {u.mustChangePassword && <div className="text-ink-3">Must set own password</div>}
                    <div className="text-ink-3">{u.immichLinked ? 'Immich linked' : 'Immich not linked'}</div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-3">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {u.locked && (
                        <button className="icon-btn" title="Unlock sign-in" onClick={() => unlock(u)}>
                          <Unlock size={15} />
                        </button>
                      )}
                      <button className="icon-btn" title="Edit name or role" onClick={() => setEditing(u)}>
                        <Pencil size={15} />
                      </button>
                      <button className="icon-btn" title="Reset password" onClick={() => setResetFor(u)}>
                        <KeyRound size={15} />
                      </button>
                      {u.id !== me.id && (
                        <button
                          className="icon-btn"
                          title={u.disabled ? 'Enable account' : 'Disable account (signs them out)'}
                          onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? `${u.displayName} is enabled.` : `${u.displayName} is disabled and signed out.`)}
                        >
                          {u.disabled ? <ShieldCheck size={15} /> : <UserX size={15} />}
                        </button>
                      )}
                      {u.id !== me.id && (
                        <button className="icon-btn text-bad" title="Delete account" onClick={() => setDeleting(u)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddUserModal
          onClose={() => setAdding(false)}
          onCreated={(user, password) => {
            setAdding(false);
            setIssued({ user, password, created: true });
            void load();
          }}
        />
      )}
      {editing && (
        <EditUserModal
          u={editing}
          isSelf={editing.id === me.id}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await patch(editing, body, 'Saved.');
            setEditing(null);
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          u={resetFor}
          onClose={() => setResetFor(null)}
          onDone={(password) => {
            setIssued({ user: resetFor, password, created: false });
            setResetFor(null);
            void load();
          }}
        />
      )}
      {deleting && (
        <DeleteUserModal
          u={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            toast(`${deleting.displayName}’s account was deleted.`);
            setDeleting(null);
            void load();
          }}
        />
      )}
      {issued && <IssuedPassword {...issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: AdminUserDto, password: string) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(tempPassword);
  const [role, setRole] = useState<UserRole>('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await api.post<AdminUserDto>('/api/admin/users', { username: username.trim().toLowerCase(), displayName: displayName.trim(), password, role });
      onCreated(u, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title="Add a household member"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !username.trim() || password.length < 10} onClick={() => submit()}>
            {busy ? <Spinner size={13} className="text-white" /> : <UserPlus size={14} />} Create account
          </button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <label className="block">
          <span className="label">Username</span>
          <input className="input" autoFocus autoCapitalize="none" spellCheck={false} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. sam" />
          <span className="mt-1 block text-[11px] text-ink-3">Lowercase letters, numbers, dots, dashes or underscores. Also names their private photo folder.</span>
        </label>
        <label className="block">
          <span className="label">Display name</span>
          <input className="input" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username.trim() || 'e.g. Sam'} />
        </label>
        <label className="block">
          <span className="label">Temporary password</span>
          <div className="flex gap-2">
            <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />
            <button type="button" className="btn" title="Generate another" onClick={() => setPassword(tempPassword())}>
              <RefreshCw size={14} />
            </button>
          </div>
          <span className="mt-1 block text-[11px] text-ink-3">They must replace it with their own password the first time they sign in.</span>
        </label>
        <div>
          <span className="label">Role</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['user', 'Member', 'Makes and exports their own cards.'],
                ['admin', 'Admin', 'Also manages users, the Immich address and the security log.'],
              ] as const
            ).map(([id, label, hint]) => (
              <label key={id} className={clsx('cursor-pointer rounded-lg border px-3 py-2', role === id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-paper-2')}>
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <input type="radio" name="role" checked={role === id} onChange={() => setRole(id)} /> {label}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>
              </label>
            ))}
          </div>
        </div>
        {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function EditUserModal({ u, isSelf, onClose, onSave }: { u: AdminUserDto; isSelf: boolean; onClose: () => void; onSave: (b: { displayName?: string; role?: UserRole }) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(u.displayName);
  const [role, setRole] = useState<UserRole>(u.role);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title={`Edit ${u.displayName}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !displayName.trim()}
            onClick={async () => {
              setBusy(true);
              await onSave({ ...(displayName.trim() !== u.displayName ? { displayName: displayName.trim() } : {}), ...(role !== u.role ? { role } : {}) });
              setBusy(false);
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label">Display name</span>
          <input className="input" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="user">Member</option>
            <option value="admin">Admin</option>
          </select>
          {isSelf && role !== 'admin' && <span className="mt-1 block text-[11px] text-warn">You’ll lose access to this admin page.</span>}
        </label>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ u, onClose, onDone }: { u: AdminUserDto; onClose: () => void; onDone: (password: string) => void }) {
  const [password, setPassword] = useState(tempPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title={`Reset ${u.displayName}’s password`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || password.length < 10}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api.post(`/api/admin/users/${enc(u.id)}/password`, { password });
                onDone(password);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={13} className="text-white" />} Reset password
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink-2">
          {u.displayName} is signed out everywhere and must choose a new password at their next sign-in. Their cards and Immich link are kept.
        </p>
        <label className="block">
          <span className="label">Temporary password</span>
          <div className="flex gap-2">
            <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} />
            <button type="button" className="btn" title="Generate another" onClick={() => setPassword(tempPassword())}>
              <RefreshCw size={14} />
            </button>
          </div>
        </label>
        {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
      </div>
    </Modal>
  );
}

function DeleteUserModal({ u, onClose, onDeleted }: { u: AdminUserDto; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title={`Delete ${u.displayName}’s account?`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            disabled={busy || typed.trim().toLowerCase() !== u.username}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api.del(`/api/admin/users/${enc(u.id)}`);
                onDeleted();
              } catch (e: any) {
                setError(e.message);
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={13} className="text-white" />} Delete account
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-ink-2">
        <p>
          This removes the account, signs it out and forgets its Immich key. Their cards, uploads and exports move to the <code>.trash</code> folder inside each data folder and are
          removed for good after 30 days.
        </p>
        <p>If you only want to stop them signing in for now, disable the account instead.</p>
        <label className="block">
          <span className="label">
            Type <b className="font-mono">{u.username}</b> to confirm
          </span>
          <input className="input font-mono" autoCapitalize="none" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-bad">{error}</div>}
      </div>
    </Modal>
  );
}

function IssuedPassword({ user, password, created, onClose }: { user: AdminUserDto; password: string; created: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `HomeCard: ${location.origin}/login\nUsername: ${user.username}\nTemporary password: ${password}`;
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title={created ? `${user.displayName}’s account is ready` : 'Password reset'}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="text-ink-2">Give {user.displayName} these sign-in details in person or by a private message. This is the only time the temporary password is shown.</p>
        <pre className="whitespace-pre-wrap rounded-lg border border-line bg-paper-2 px-3 py-2.5 font-mono text-[12px] text-ink">{text}</pre>
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              useUi.getState().toast('Copy isn’t available here — select the text instead.', 'info');
            }
          }}
        >
          <Copy size={14} /> {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </Modal>
  );
}
