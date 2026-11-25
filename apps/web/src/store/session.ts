import { create } from 'zustand';
import type { AuthState, SessionUser, UserPrefs } from '@homecard/shared';
import { api } from '@/lib/api';

interface SessionStore {
  user: SessionUser | null;
  loaded: boolean;
  /** Reads /api/auth/state (which also refreshes the CSRF cookie). */
  load: () => Promise<SessionUser | null>;
  setUser: (u: SessionUser) => void;
  savePrefs: (prefs: UserPrefs) => Promise<void>;
  logout: () => Promise<void>;
}

let prefQueue: Promise<unknown> = Promise.resolve();
let prefSeq = 0;

export const useSession = create<SessionStore>((set, get) => ({
  user: null,
  loaded: false,
  async load() {
    const s = await api.get<AuthState>('/api/auth/state');
    set({ user: s.user, loaded: true });
    if (!s.user) location.assign(`/login?next=${encodeURIComponent(location.pathname + location.hash)}`);
    else if (s.user.mustChangePassword) location.assign('/login?change=1');
    return s.user;
  },
  setUser: (user) => set({ user }),
  // Shows the change at once; saves go out one after another and only the newest reply is applied.
  // The server merges the fields sent over what it already has.
  savePrefs(prefs) {
    const user = get().user;
    if (!user) return Promise.resolve();
    const before = user.prefs;
    const seq = ++prefSeq;
    set({ user: { ...user, prefs: { ...before, ...prefs } } });
    const job = prefQueue.then(() =>
      api.put<SessionUser>('/api/auth/me', { prefs }).then(
        (u) => {
          if (seq === prefSeq) set({ user: u });
        },
        (e: Error) => {
          const now = get().user;
          if (seq === prefSeq && now) set({ user: { ...now, prefs: before } });
          throw e;
        },
      ),
    );
    prefQueue = job.catch(() => undefined);
    return job;
  },
  async logout() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      location.assign('/login');
    }
  },
}));

export const isAdmin = () => useSession.getState().user?.role === 'admin';
