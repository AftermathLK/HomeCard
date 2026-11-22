/// <reference lib="webworker" />
/**
 * Off-main-thread image work for the editor:
 *  - "polish": apply the Photo Polish pixel pipeline to the preview (same code the server uses at print time)
 *  - "analyze": image statistics (Auto-Enhance), dominant palette (Color Harmony) and saliency focus
 */
import { applyPipeline, buildPipeline, computeImageStats, extractPalette, saliencyFocus, type Adjustments } from '@homecard/shared';

type Msg =
  | { type: 'polish'; id: number; url: string; adj: Partial<Adjustments>; maxSize: number }
  | { type: 'analyze'; id: number; url: string };

const bitmaps = new Map<string, Promise<ImageBitmap>>();

function bitmap(url: string) {
  let p = bitmaps.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b));
    p.catch(() => bitmaps.delete(url));
    bitmaps.set(url, p);
    // Keep a handful of decoded previews around.
    if (bitmaps.size > 8) {
      const first = bitmaps.keys().next().value as string;
      bitmaps.get(first)?.then((bm) => bm.close()).catch(() => {});
      bitmaps.delete(first);
    }
  }
  return p;
}

function draw(bm: ImageBitmap, maxSize: number) {
  const s = Math.min(1, maxSize / Math.max(bm.width, bm.height));
  const w = Math.max(1, Math.round(bm.width * s));
  const h = Math.max(1, Math.round(bm.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bm, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    const bm = await bitmap(msg.url);
    if (msg.type === 'polish') {
      const { canvas, ctx, w, h } = draw(bm, msg.maxSize);
      const img = ctx.getImageData(0, 0, w, h);
      applyPipeline(img.data, 4, buildPipeline(msg.adj));
      ctx.putImageData(img, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      (self as unknown as Worker).postMessage({ id: msg.id, blob });
    } else {
      const { ctx, w, h } = draw(bm, 320);
      const data = ctx.getImageData(0, 0, w, h).data;
      const stats = computeImageStats(data, 4);
      const palette = extractPalette(data, 4, 5);
      const small = draw(bm, 64);
      const focus = saliencyFocus(small.ctx.getImageData(0, 0, small.w, small.h).data, small.w, small.h, 4);
      (self as unknown as Worker).postMessage({ id: msg.id, stats, palette, focus });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, error: String((err as Error)?.message ?? err) });
  }
};
