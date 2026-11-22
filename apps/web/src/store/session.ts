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
  async savePrefs(prefs) {
    const u = await api.put<SessionUser>('/api/auth/me', { prefs: { ...get().user?.prefs, ...prefs } });
    set({ user: u });
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
