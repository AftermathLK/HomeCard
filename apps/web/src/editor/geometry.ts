import type { CardElement, CardFormat, RectIn } from '@homecard/shared';

export const PX = 96;

/** Snap candidate lines (inches) for a surface. */
export function snapLines(format: CardFormat, elements: CardElement[], excludeIds: Set<string>) {
  const W = format.widthIn, H = format.heightIn, s = format.safeIn, b = format.bleedIn;
  const xs: Array<{ v: number; kind: 'card' | 'safe' | 'el' }> = [
    { v: 0, kind: 'card' }, { v: W / 2, kind: 'card' }, { v: W, kind: 'card' },
    { v: s, kind: 'safe' }, { v: W - s, kind: 'safe' },
  ];
  const ys: typeof xs = [
    { v: 0, kind: 'card' }, { v: H / 2, kind: 'card' }, { v: H, kind: 'card' },
    { v: s, kind: 'safe' }, { v: H - s, kind: 'safe' },
  ];
  if (b > 0) {
    xs.push({ v: -b, kind: 'card' }, { v: W + b, kind: 'card' });
    ys.push({ v: -b, kind: 'card' }, { v: H + b, kind: 'card' });
  }
  for (const e of elements) {
    if (excludeIds.has(e.id) || e.hidden || e.rotation) continue;
    xs.push({ v: e.x, kind: 'el' }, { v: e.x + e.w / 2, kind: 'el' }, { v: e.x + e.w, kind: 'el' });
    ys.push({ v: e.y, kind: 'el' }, { v: e.y + e.h / 2, kind: 'el' }, { v: e.y + e.h, kind: 'el' });
  }
  return { xs, ys };
}

/** Snap a moving box: tries its left/centre/right (top/middle/bottom) against the candidate lines. */
export function snapBox(r: RectIn, lines: ReturnType<typeof snapLines>, tolIn: number) {
  let dx = 0, dy = 0;
  const gx: number[] = [], gy: number[] = [];
  let best = tolIn;
  for (const edge of [r.x, r.x + r.w / 2, r.x + r.w])
    for (const l of lines.xs) {
      const d = l.v - edge;
      if (Math.abs(d) < best - 1e-9) {
        best = Math.abs(d);
        dx = d;
      }
    }
  best = tolIn;
  for (const edge of [r.y, r.y + r.h / 2, r.y + r.h])
    for (const l of lines.ys) {
      const d = l.v - edge;
      if (Math.abs(d) < best - 1e-9) {
        best = Math.abs(d);
        dy = d;
      }
    }
  const snapped = { ...r, x: r.x + dx, y: r.y + dy };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const ex = [snapped.x, snapped.x + snapped.w / 2, snapped.x + snapped.w];
  const ey = [snapped.y, snapped.y + snapped.h / 2, snapped.y + snapped.h];
  for (const l of lines.xs) if (ex.some((e) => near(e, l.v))) gx.push(l.v);
  for (const l of lines.ys) if (ey.some((e) => near(e, l.v))) gy.push(l.v);
  return { rect: snapped, guidesX: [...new Set(gx)], guidesY: [...new Set(gy)] };
}

export function snapValue(v: number, candidates: number[], tol: number): { v: number; hit: number | null } {
  let best = tol, out = v, hit: number | null = null;
  for (const c of candidates) {
    const d = Math.abs(c - v);
    if (d < best) {
      best = d;
      out = c;
      hit = c;
    }
  }
  return { v: out, hit };
}

/** Resize a (possibly rotated) box by dragging handle (hx, hy ∈ {-1,0,1}) with a world-space delta. */
export function resizeBox(
  start: { x: number; y: number; w: number; h: number; rotation: number },
  hx: number,
  hy: number,
  dX: number,
  dY: number,
  keepAspect: boolean,
  minSize = 0.1,
) {
  const th = (start.rotation * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  // world delta -> local
  const lx = dX * cos + dY * sin;
  const ly = -dX * sin + dY * cos;
  let w = start.w + hx * lx;
  let h = start.h + hy * ly;
  if (keepAspect && hx !== 0 && hy !== 0) {
    const s = Math.max(w / start.w, h / start.h);
    w = start.w * s;
    h = start.h * s;
  } else if (keepAspect && hx !== 0) {
    h = start.h * (w / start.w);
  } else if (keepAspect && hy !== 0) {
    w = start.w * (h / start.h);
  }
  w = Math.max(minSize, w);
  h = Math.max(minSize, h);
  const cx0 = start.x + start.w / 2, cy0 = start.y + start.h / 2;
  // anchor = opposite handle, fixed in world space
  const ax = cx0 + cos * (-hx * start.w / 2) - sin * (-hy * start.h / 2);
  const ay = cy0 + sin * (-hx * start.w / 2) + cos * (-hy * start.h / 2);
  const hxEff = hx === 0 && keepAspect ? 0 : hx;
  const hyEff = hy === 0 && keepAspect ? 0 : hy;
  const cx = ax + cos * (hxEff * w / 2) - sin * (hyEff * h / 2);
  const cy = ay + sin * (hxEff * w / 2) + cos * (hyEff * h / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;
