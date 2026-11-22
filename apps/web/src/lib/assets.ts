import { create } from 'zustand';
import {
  clearCustomTemplates,
  parsePackAssetRef,
  registerCustomTemplates,
  type FontFamilyInfo,
  type HealthInfo,
  type ResolvedStylePack,
} from '@homecard/shared';
import { api, onServerEvent } from './api';

/**
 * Fonts, Style Packs and server health — loaded once, live-reloaded over SSE when files change
 * in /data/fonts or /data/styles.
 */
interface AssetsState {
  fonts: FontFamilyInfo[];
  fontsVersion: number;
  packs: ResolvedStylePack[];
  stylesVersion: number;
  /** True once /api/styles has answered (pack-asset checks need the real list). */
  stylesLoaded: boolean;
  /** Bumped whenever a web font finishes loading (text auto-fit re-measures). */
  fontLoadTick: number;
  health: HealthInfo | null;
  loaded: boolean;
  loadFonts: () => Promise<void>;
  loadStyles: () => Promise<void>;
  loadHealth: (deep?: boolean) => Promise<HealthInfo>;
  init: () => Promise<void>;
}

let fontLink: HTMLLinkElement | null = null;

export function injectFontCss(version: number) {
  if (typeof document === 'undefined') return;
  const href = `/api/fonts/fonts.css?v=${version}`;
  if (fontLink?.getAttribute('href') === href) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  const old = fontLink;
  link.onload = () => old?.remove();
  fontLink = link;
}

export const useAssets = create<AssetsState>((set, get) => ({
  fonts: [],
  fontsVersion: 0,
  packs: [],
  stylesVersion: 0,
  stylesLoaded: false,
  fontLoadTick: 0,
  health: null,
  loaded: false,
  async loadFonts() {
    const r = await api.get<{ version: number; families: FontFamilyInfo[] }>('/api/fonts');
    injectFontCss(r.version);
    set({ fonts: r.families, fontsVersion: r.version });
  },
  async loadStyles() {
    const r = await api.get<{ version: number; packs: ResolvedStylePack[] }>('/api/styles');
    applyPackTemplates(r.packs);
    svgCache.clear();
    set({ packs: r.packs, stylesVersion: r.version, stylesLoaded: true });
  },
  async loadHealth(deep = false) {
    const h = await api.get<HealthInfo>(`/api/health${deep ? '' : '?quick=1'}`);
    set({ health: h });
    return h;
  },
  async init() {
    if (get().loaded) return;
    set({ loaded: true });
    await Promise.all([get().loadFonts(), get().loadStyles(), get().loadHealth().catch(() => null)]);
    onServerEvent((type) => {
      if (type === 'fonts') void get().loadFonts();
      if (type === 'styles') void get().loadStyles();
    });
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', () => set((s) => ({ fontLoadTick: s.fontLoadTick + 1 })));
    }
  },
}));

export function applyPackTemplates(packs: ResolvedStylePack[]) {
  clearCustomTemplates();
  for (const p of packs) if (p.templates.length) registerCustomTemplates(p.templates, p.id);
}

/* ---------- Sanitized pack SVG markup (inlined so it can be recoloured) ---------- */

const svgCache = new Map<string, Promise<string>>();
const svgResolved = new Map<string, string>();

export function packSvgUrl(ref: string) {
  const p = parsePackAssetRef(ref);
  if (!p) return null;
  return `/api/styles/file/${encodeURIComponent(p.packId)}/${p.file.split('/').map(encodeURIComponent).join('/')}`;
}

/** Background image URL for a texture ref: style pack ("pack:…") or downloaded stock image ("stock:…"). */
export function textureUrl(ref: string): string | null {
  if (ref.startsWith('stock:')) {
    const name = ref.slice(6);
    return /^[a-z]+-[A-Za-z0-9_-]{1,80}\.jpg$/.test(name) ? `/api/stock/file/${encodeURIComponent(name)}` : null;
  }
  return packSvgUrl(ref);
}

export function loadPackSvg(ref: string): Promise<string> {
  let p = svgCache.get(ref);
  if (!p) {
    const url = packSvgUrl(ref);
    p = url
      ? fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`SVG ${r.status}`))))
      : Promise.reject(new Error('Not a pack asset'));
    p.then((t) => svgResolved.set(ref, t)).catch(() => svgCache.delete(ref));
    svgCache.set(ref, p);
  }
  return p;
}

export function cachedPackSvg(ref: string): string | undefined {
  return svgResolved.get(ref);
}

export function findPackOrnament(packs: ResolvedStylePack[], ref: string) {
  for (const p of packs) {
    const o = p.ornaments.find((x) => x.asset === ref);
    if (o) return o;
  }
  return undefined;
}

export function findPackBackground(packs: ResolvedStylePack[], ref: string) {
  for (const p of packs) {
    const o = p.backgrounds.find((x) => x.asset === ref);
    if (o) return o;
  }
  return undefined;
}

/** Foils from style packs (ids are already "pack:<packId>/<foilId>"). */
export function allFoils(packs: ResolvedStylePack[]) {
  return packs.flatMap((p) => p.foils);
}
