import { produce, setAutoFreeze } from 'immer';
import { create } from 'zustand';
import {
  surfacesFor,
  type CardElement,
  type CardProject,
  type Surface,
  type SurfaceId,
} from '@homecard/shared';
import { api } from '@/lib/api';

setAutoFreeze(false);

const HISTORY_MAX = 150;
const COALESCE_MS = 900;
const AUTOSAVE_MS = 900;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface EditorState {
  project: CardProject | null;
  past: CardProject[];
  future: CardProject[];
  lastKey: string | null;
  lastAt: number;
  surfaceId: SurfaceId;
  selection: string[];
  saveState: SaveState;
  saveError: string | null;
  loadError: string | null;

  open: (id: string) => Promise<void>;
  openProject: (p: CardProject) => void;
  close: () => void;
  /** Replace the project. `key` coalesces rapid edits (slider drags, nudges) into one undo step. */
  commit: (next: CardProject, key?: string | null) => void;
  /** Replace without creating an undo step (background updates such as late face detection). */
  replaceSilently: (next: CardProject) => void;
  /** Immer-style mutation. */
  edit: (recipe: (draft: CardProject) => void, key?: string | null) => void;
  /** `key` undefined = coalesce edits to this element; null = always a separate undo step. */
  updateElement: (id: string, patch: Partial<CardElement> | ((el: CardElement) => void), key?: string | null) => void;
  updateSurface: (sid: SurfaceId, recipe: (s: Surface) => void, key?: string | null) => void;
  undo: () => void;
  redo: () => void;
  setSurface: (id: SurfaceId) => void;
  select: (ids: string[] | string | null) => void;
  saveNow: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  surfaceId: 'front',
  selection: [],
  saveState: 'saved',
  saveError: null,
  loadError: null,

  async open(id) {
    set({ loadError: null });
    try {
      const p = await api.get<CardProject>(`/api/projects/${encodeURIComponent(id)}`);
      get().openProject(p);
    } catch (err: any) {
      set({ loadError: err.message ?? String(err) });
    }
  },

  openProject(p) {
    set({ project: p, past: [], future: [], lastKey: null, lastAt: 0, surfaceId: 'front', selection: [], saveState: 'saved', saveError: null });
  },

  close() {
    void get().saveNow();
    set({ project: null, past: [], future: [], selection: [] });
  },

  commit(next, key = null) {
    const { project, past, lastKey, lastAt } = get();
    if (!project || next === project) return;
    const now = Date.now();
    const coalesce = !!key && key === lastKey && now - lastAt < COALESCE_MS;
    const newPast = coalesce ? past : [...past, project].slice(-HISTORY_MAX);
    // Keep the active surface valid if the format changed (e.g. flat ↔ folded).
    const valid = surfacesFor(next.format);
    const surfaceId = valid.includes(get().surfaceId) ? get().surfaceId : valid[0];
    set({ project: next, past: newPast, future: [], lastKey: key, lastAt: now, surfaceId, saveState: 'dirty' });
    scheduleSave();
  },

  replaceSilently(next) {
    if (!get().project) return;
    set({ project: next, saveState: 'dirty' });
    scheduleSave();
  },

  edit(recipe, key) {
    const p = get().project;
    if (!p) return;
    get().commit(produce(p, recipe), key);
  },

  updateElement(id, patch, key) {
    get().edit((d) => {
      for (const s of d.surfaces) {
        const el = s.elements.find((e) => e.id === id);
        if (!el) continue;
        if (typeof patch === 'function') patch(el);
        else Object.assign(el, patch);
        return;
      }
    }, key === undefined ? `el:${id}` : key);
  },

  updateSurface(sid, recipe, key) {
    get().edit((d) => {
      const s = d.surfaces.find((x) => x.id === sid);
      if (s) recipe(s);
    }, key);
  },

  undo() {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_MAX), lastKey: null, saveState: 'dirty' });
    pruneSelection();
    scheduleSave();
  },

  redo() {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), lastKey: null, saveState: 'dirty' });
    pruneSelection();
    scheduleSave();
  },

  setSurface(id) {
    set({ surfaceId: id, selection: [] });
  },

  select(ids) {
    set({ selection: ids === null ? [] : Array.isArray(ids) ? ids : [ids] });
  },

  async saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (saving) await saving;
    const p = get().project;
    if (!p || get().saveState === 'saved') return;
    set({ saveState: 'saving' });
    saving = api
      .put<{ updatedAt: string }>(`/api/projects/${encodeURIComponent(p.id)}`, p)
      .then(() => {
        // Only mark saved if nothing changed while the request was in flight.
        if (get().project === p) set({ saveState: 'saved', saveError: null });
        else set({ saveState: 'dirty' });
      })
      .catch((err) => set({ saveState: 'error', saveError: err.message ?? String(err) }))
      .finally(() => {
        saving = null;
      });
    await saving;
    if (get().saveState === 'dirty') scheduleSave();
  },
}));

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void useEditor.getState().saveNow();
  }, AUTOSAVE_MS);
}

function pruneSelection() {
  const { project, selection, surfaceId } = useEditor.getState();
  const s = project?.surfaces.find((x) => x.id === surfaceId);
  if (!s) return;
  const ids = new Set(s.elements.map((e) => e.id));
  const next = selection.filter((id) => ids.has(id));
  if (next.length !== selection.length) useEditor.setState({ selection: next });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const st = useEditor.getState().saveState;
    if (st === 'dirty' || st === 'saving') {
      void useEditor.getState().saveNow();
      e.preventDefault();
    }
  });
}

/* ---------- Selectors ---------- */

export const useProject = () => useEditor((s) => s.project);
export function useSurface(): Surface | null {
  return useEditor((s) => s.project?.surfaces.find((x) => x.id === s.surfaceId) ?? null);
}
export function useSelected(): CardElement | null {
  return useEditor((s) => {
    const id = s.selection[0];
    if (!id || !s.project) return null;
    for (const surf of s.project.surfaces) {
      const el = surf.elements.find((e) => e.id === id);
      if (el) return el;
    }
    return null;
  });
}

export function findElement(p: CardProject, id: string): { surface: Surface; el: CardElement; index: number } | null {
  for (const surface of p.surfaces) {
    const index = surface.elements.findIndex((e) => e.id === id);
    if (index >= 0) return { surface, el: surface.elements[index], index };
  }
  return null;
}
