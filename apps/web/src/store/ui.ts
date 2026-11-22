import { create } from 'zustand';
import type { RectIn } from '@homecard/shared';

export type AppMode = 'guided' | 'studio';
export type StudioTab = 'card' | 'templates' | 'photos' | 'text' | 'style' | 'backgrounds' | 'polish' | 'decor' | 'layers' | 'check';
export type SettingsTab = 'profile' | 'immich' | 'users' | 'audit' | 'server' | 'fonts' | 'styles' | 'printing' | 'system';
export type ViewMode = 'editor' | 'mockup';

export interface PickerTarget {
  /** Photo element to fill (null = just add to the tray). */
  elementId: string | null;
  multiple: boolean;
}

interface UiState {
  route: { name: 'home' } | { name: 'editor'; projectId: string };
  mode: AppMode;
  step: 1 | 2 | 3 | 4;
  /** Sub-tab inside the current guided step. */
  subTab: string;
  tab: StudioTab;
  view: ViewMode;
  zoom: number | 'fit';
  showGuides: boolean;
  showSafe: boolean;
  cropId: string | null;
  editingTextId: string | null;
  compareIds: Set<string>;
  picker: PickerTarget | null;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  exportOpen: boolean;
  newCardOpen: boolean;
  toasts: Array<{ id: number; kind: 'info' | 'ok' | 'error'; text: string }>;
  /** Text measurements from the live canvas (Print Guardian). */
  textInk: Record<string, RectIn | undefined>;
  textOverflow: Record<string, boolean | undefined>;
  textContrast: Record<string, number | undefined>;
  failedRefs: string[];

  go: (r: UiState['route']) => void;
  set: (patch: Partial<UiState>) => void;
  toast: (text: string, kind?: 'info' | 'ok' | 'error') => void;
  setCompare: (id: string, on: boolean) => void;
  openSettings: (tab?: SettingsTab) => void;
}

let toastId = 0;

function routeFromHash(): UiState['route'] {
  const m = /^#\/card\/([\w-]+)/.exec(location.hash);
  return m ? { name: 'editor', projectId: m[1] } : { name: 'home' };
}

export const useUi = create<UiState>((set, get) => ({
  route: typeof location !== 'undefined' ? routeFromHash() : { name: 'home' },
  mode: (localStorage.getItem('hc.mode') as AppMode) || 'guided',
  step: 1,
  subTab: '',
  tab: 'templates',
  view: 'editor',
  zoom: 'fit',
  showGuides: true,
  showSafe: true,
  cropId: null,
  editingTextId: null,
  compareIds: new Set(),
  picker: null,
  settingsOpen: false,
  settingsTab: 'profile',
  exportOpen: false,
  newCardOpen: false,
  toasts: [],
  textInk: {},
  textOverflow: {},
  textContrast: {},
  failedRefs: [],

  go(r) {
    const hash = r.name === 'editor' ? `#/card/${r.projectId}` : '#/';
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ route: r, cropId: null, editingTextId: null, view: 'editor' });
  },
  set(patch) {
    if (patch.mode) localStorage.setItem('hc.mode', patch.mode);
    set(patch);
  },
  toast(text, kind = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3500);
  },
  setCompare(id, on) {
    const next = new Set(get().compareIds);
    if (on) next.add(id);
    else next.delete(id);
    set({ compareIds: next });
  },
  openSettings(tab) {
    set({ settingsOpen: true, ...(tab ? { settingsTab: tab } : {}) });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => useUi.setState({ route: routeFromHash() }));
}
