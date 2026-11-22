import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { FileClock, Images, LogOut, Server, Settings, UserRound, Users } from 'lucide-react';
import { useSession } from '@/store/session';
import { useUi, type SettingsTab } from '@/store/ui';

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Signed-in account: profile, Immich connection, admin pages and sign out. */
export function UserMenu({ compact }: { compact?: boolean }) {
  const user = useSession((s) => s.user);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const go = (tab: SettingsTab) => {
    setOpen(false);
    useUi.getState().openSettings(tab);
  };
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-paper-2';

  return (
    <div className="relative" ref={ref}>
      <button
        className={clsx('flex items-center gap-2 rounded-full border border-line bg-white py-0.5 pl-0.5 shadow-sm hover:border-line-2', compact ? 'pr-0.5' : 'pr-3')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${user.displayName} (${user.username})`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">{initials(user.displayName)}</span>
        {!compact && <span className="max-w-[140px] truncate text-[13px] font-medium">{user.displayName}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-line bg-white p-1 shadow-pop">
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="truncate text-[13px] font-semibold">{user.displayName}</div>
            <div className="truncate text-[12px] text-ink-3">
              @{user.username} · {user.role === 'admin' ? 'Admin' : 'Member'}
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          <button role="menuitem" className={item} onClick={() => go('profile')}>
            <UserRound size={15} /> Profile & password
          </button>
          <button role="menuitem" className={item} onClick={() => go('immich')}>
            <Images size={15} /> Immich connection
          </button>
          <button role="menuitem" className={item} onClick={() => go('fonts')}>
            <Settings size={15} /> Fonts, styles & printing
          </button>
          {user.role === 'admin' && (
            <>
              <div className="my-1 border-t border-line" />
              <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Admin</div>
              <button role="menuitem" className={item} onClick={() => go('users')}>
                <Users size={15} /> Users
              </button>
              <button role="menuitem" className={item} onClick={() => go('audit')}>
                <FileClock size={15} /> Security log
              </button>
              <button role="menuitem" className={item} onClick={() => go('server')}>
                <Server size={15} /> Server settings
              </button>
            </>
          )}
          <div className="my-1 border-t border-line" />
          <button
            role="menuitem"
            className={clsx(item, 'text-ink-2')}
            onClick={() => {
              setOpen(false);
              void useSession.getState().logout();
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
