import { useEffect, useState } from 'react';
import {
  adjustmentsKey,
  autoEnhance,
  effectiveAdjustments,
  pixelAdjustments,
  toBase64Url,
  type Adjustments,
  type ImageStats,
  type PaletteColor,
  type PhotoFill,
} from '@homecard/shared';
import { enc } from './api';

export const thumbUrl = (ref: string) => `/api/media/thumb?ref=${enc(ref)}`;
export const previewUrl = (ref: string) => `/api/media/preview?ref=${enc(ref)}`;

/** Full-resolution print source at an exact pixel width with Photo Polish baked in server-side. */
export function printUrl(ref: string, widthPx: number, adj?: Partial<Adjustments> | null) {
  const a = adj && Object.keys(adj).length ? `&adj=${toBase64Url(adj)}` : '';
  return `/api/media/print?ref=${enc(ref)}&w=${Math.max(16, Math.ceil(widthPx))}${a}`;
}

/* ---------- Worker plumbing ---------- */

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (v: any) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data);
    };
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (d) => (d.error ? reject(new Error(d.error)) : resolve(d)));
    getWorker().postMessage({ ...msg, id });
  });
}

export interface ImageAnalysis {
  stats: ImageStats;
  palette: PaletteColor[];
  focus: { x: number; y: number };
}

const analysisCache = new Map<string, Promise<ImageAnalysis>>();
export function analyzeImage(ref: string): Promise<ImageAnalysis> {
  let p = analysisCache.get(ref);
  if (!p) {
    p = call<ImageAnalysis>({ type: 'analyze', url: new URL(previewUrl(ref), location.href).href });
    p.catch(() => analysisCache.delete(ref));
    analysisCache.set(ref, p);
  }
  return p;
}

export async function autoEnhanceFor(ref: string): Promise<Adjustments> {
  const a = await analyzeImage(ref);
  return autoEnhance(a.stats);
}

/* ---------- Polished preview (editor) ---------- */

const polishCache = new Map<string, Promise<string>>();
const polishResolved = new Map<string, string>();
const POLISH_CACHE_MAX = 80;

function polishedPreview(ref: string, adj: Partial<Adjustments>, maxSize: number): Promise<string> {
  const key = `${ref}|${maxSize}|${JSON.stringify(adj)}`;
  let p = polishCache.get(key);
  if (!p) {
    p = call<{ blob: Blob }>({ type: 'polish', url: new URL(previewUrl(ref), location.href).href, adj, maxSize }).then((r) => {
      const u = URL.createObjectURL(r.blob);
      polishResolved.set(key, u);
      return u;
    });
    p.catch(() => polishCache.delete(key));
    polishCache.set(key, p);
    if (polishCache.size > POLISH_CACHE_MAX) {
      const oldest = polishCache.keys().next().value as string;
      const url = polishResolved.get(oldest);
      if (url) URL.revokeObjectURL(url);
      polishResolved.delete(oldest);
      polishCache.delete(oldest);
    }
  }
  return p;
}

/** Small polished rendition (filter swatches, before/after thumbnails). */
export function polishedThumb(ref: string, adj: Partial<Adjustments>, size = 220): Promise<string> {
  return polishedPreview(ref, adj, size);
}

/**
 * Editor image source for a photo fill: the cached preview, or a worker-polished copy when
 * Photo Polish is active (keeps showing the previous result while a new one is computed).
 */
export function useEditorPhotoSrc(fill: PhotoFill | null, compare: boolean): string | null {
  const adj = fill ? pixelAdjustments(effectiveAdjustments(fill.polish)) : {};
  const hasAdj = Object.keys(adj).length > 0;
  const key = fill ? `${fill.ref}|${adjustmentsKey(effectiveAdjustments(fill.polish))}` : '';
  const base = fill ? previewUrl(fill.ref) : null;
  const [src, setSrc] = useState<string | null>(base);

  useEffect(() => {
    if (!fill) return setSrc(null);
    if (!hasAdj || compare) return setSrc(previewUrl(fill.ref));
    let alive = true;
    const cachedKey = `${fill.ref}|1600|${JSON.stringify(adj)}`;
    const ready = polishResolved.get(cachedKey);
    if (ready) {
      setSrc(ready);
      return;
    }
    // Quick low-res pass while dragging sliders, then full preview.
    const t = setTimeout(() => {
      polishedPreview(fill.ref, adj, 640)
        .then((u) => alive && setSrc(u))
        .then(() => polishedPreview(fill.ref, adj, 1600))
        .then((u) => alive && u && setSrc(u))
        .catch(() => alive && setSrc(previewUrl(fill.ref)));
    }, 30);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, compare]);

  return src ?? base;
}

/** Load an image element and resolve when decoded (used to preload textures in the renderer). */
export function preloadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => img.decode().then(() => resolve(img), () => resolve(img));
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}
