/**
 * Some collections give Openverse a resized copy of a photo as its URL while reporting the
 * original's pixel size (StockSnap hands out its 960 px-wide thumbnail, Flickr links carry a size
 * suffix). Search results show how sharply an image will print, so cap the size to what that URL
 * really serves; otherwise a "prints sharp" badge turns into a soft 130 DPI print.
 */

/** Longest side served for each Flickr size suffix (https://www.flickr.com/services/api/misc.urls.html). */
const FLICKR_LONG_SIDE: Record<string, number> = { s: 75, q: 150, t: 100, m: 240, n: 320, w: 400, z: 640, c: 800, b: 1024, h: 1600, k: 2048 };

export function servedSize(url: string, width: number, height: number): { width: number; height: number } {
  if (!width || !height) return { width, height };
  const u = url.split(/[?#]/)[0];
  let maxWidth = Infinity;
  let maxLong = Infinity;
  const snap = /\/img-thumbs\/(\d{2,5})w\//i.exec(u);
  if (snap) maxWidth = Number(snap[1]);
  const flickr = /staticflickr\.com\/.+_([a-z])\.(?:jpe?g|png|gif)$/i.exec(u);
  if (flickr && FLICKR_LONG_SIDE[flickr[1].toLowerCase()]) maxLong = FLICKR_LONG_SIDE[flickr[1].toLowerCase()];
  const s = Math.min(1, maxWidth / width, maxLong / Math.max(width, height));
  return s < 1 ? { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) } : { width, height };
}
