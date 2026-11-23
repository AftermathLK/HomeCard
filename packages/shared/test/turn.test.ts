import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPolish,
  effectiveDpi,
  fitFill,
  imageBox,
  makeFormat,
  orientedFill,
  orientPoint,
  photoDpi,
  placeImage,
  turnFill,
  turnOrientation,
  unorientPoint,
  type FillOrientation,
  type PhotoElement,
  type PhotoFill,
  type TurnOp,
} from '../src/index';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const ALL: FillOrientation[] = [0, 90, 180, 270].flatMap((rotate) => [false, true].map((flipX) => ({ rotate: rotate as FillOrientation['rotate'], flipX })));

/** Apply an orientation to a point the way the browser does: CSS `rotate(r) scaleX(-1)` about the centre. */
function cssLike(x: number, y: number, o: FillOrientation, w: number, h: number): [number, number] {
  let px = (x - 0.5) * w, py = (y - 0.5) * h;
  if (o.flipX) px = -px;
  const t = ((o.rotate ?? 0) * Math.PI) / 180;
  const rx = px * Math.cos(t) - py * Math.sin(t);
  const ry = px * Math.sin(t) + py * Math.cos(t);
  const side = (o.rotate ?? 0) % 180 !== 0;
  const W = side ? h : w, H = side ? w : h;
  return [rx / W + 0.5, ry / H + 0.5];
}

test('orientPoint matches what a CSS turn + mirror does to the picture', () => {
  for (const o of ALL)
    for (const [x, y] of [[0, 0], [1, 0], [0.2, 0.7], [0.9, 0.35]]) {
      const [a, b] = orientPoint(x, y, o);
      const [c, d] = cssLike(x, y, o, 4000, 3000);
      close(a, c);
      close(b, d);
      // …and unorientPoint undoes it.
      const [u, v] = unorientPoint(a, b, o);
      close(u, x);
      close(v, y);
    }
});

test('a quarter turn of the top-left corner lands top-right', () => {
  assert.deepEqual(orientPoint(0, 0, { rotate: 90 }), [1, 0]);
  assert.deepEqual(orientPoint(0, 0, { flipX: true }), [1, 0]);
  assert.deepEqual(orientPoint(0, 0, { rotate: 180 }), [1, 1]);
});

test('user steps compose: four right turns, two mirrors or two flips get back to the start', () => {
  const steps = (ops: TurnOp[]) => ops.reduce<FillOrientation>((o, op) => turnOrientation(o, op), { rotate: 0, flipX: false });
  assert.deepEqual(steps(['cw', 'cw', 'cw', 'cw']), { rotate: 0, flipX: false });
  assert.deepEqual(steps(['flipH', 'flipH']), { rotate: 0, flipX: false });
  assert.deepEqual(steps(['cw', 'flipV', 'flipV']), { rotate: 90, flipX: false });
  assert.deepEqual(steps(['cw', 'ccw']), { rotate: 0, flipX: false });
  // Mirror then flip = a half turn.
  assert.deepEqual(steps(['flipH', 'flipV']), { rotate: 180, flipX: false });
  // After a quarter turn, "mirror" still mirrors what the user sees (left↔right on screen).
  for (const start of ALL) {
    const next = turnOrientation(start, 'flipH');
    const [x0, y0] = orientPoint(0.2, 0.3, start);
    const [x1, y1] = orientPoint(0.2, 0.3, next);
    close(x1, 1 - x0);
    close(y1, y0);
    const flipped = turnOrientation(start, 'flipV');
    const [x2, y2] = orientPoint(0.2, 0.3, flipped);
    close(x2, x0);
    close(y2, 1 - y0);
  }
});

const fill = (o: Partial<PhotoFill> = {}): PhotoFill => ({
  ref: 'immich:x',
  width: 6000,
  height: 4000,
  faces: [{ x: 0.7, y: 0.1, w: 0.1, h: 0.15 }],
  focus: { x: 0.25, y: 0.75 },
  crop: { cx: 0.5, cy: 0.5, zoom: 1, mode: 'manual' },
  polish: defaultPolish(),
  ...o,
});

test('orientedFill swaps the size on quarter turns and moves faces and focus', () => {
  const plain = fill();
  assert.equal(orientedFill(plain), plain, 'untouched fills pass straight through');
  const t = orientedFill(fill({ rotate: 90 }));
  assert.equal(t.width, 4000);
  assert.equal(t.height, 6000);
  // Face at top-right of a landscape photo → bottom-right of the portrait result.
  const f = t.faces![0];
  close(f.x, 1 - 0.1 - 0.15);
  close(f.y, 0.7);
  close(f.w, 0.15);
  close(f.h, 0.1);
  close(t.focus!.x, 0.25);
  close(t.focus!.y, 0.25);
  const m = orientedFill(fill({ flipX: true }));
  assert.equal(m.width, 6000);
  close(m.faces![0].x, 0.2);
});

test('turnFill keeps the same part of the photo at the frame centre', () => {
  const f0 = fill({ crop: { cx: 0.3, cy: 0.6, zoom: 1.5, mode: 'manual' } });
  for (const op of ['cw', 'ccw', 'flipH', 'flipV'] as TurnOp[]) {
    const f1 = turnFill(f0, op);
    const [u, v] = unorientPoint(f1.crop.cx, f1.crop.cy, f1);
    close(u, 0.3);
    close(v, 0.6);
    assert.equal(f1.crop.zoom, 1.5);
  }
  const back = turnFill(turnFill(f0, 'cw'), 'reset');
  assert.equal(back.rotate, undefined);
  assert.equal(back.flipX, undefined);
  close(back.crop.cx, 0.3);
  close(back.crop.cy, 0.6);
});

test('imageBox draws the un-turned image so it covers the placement', () => {
  const pl = { left: -1, top: 0.5, width: 4, height: 6 };
  const ib = imageBox(pl, { rotate: 90 });
  assert.equal(ib.width, 6);
  assert.equal(ib.height, 4);
  // Same centre.
  close(ib.left + ib.width / 2, pl.left + pl.width / 2);
  close(ib.top + ib.height / 2, pl.top + pl.height / 2);
  assert.equal(ib.transform, 'rotate(90deg)');
  assert.equal(imageBox(pl, { flipX: true, rotate: 180 }).transform, 'rotate(180deg) scaleX(-1)');
  assert.equal(imageBox(pl, {}).transform, undefined);
});

test('turning a landscape photo into a portrait frame raises its print DPI and keeps cover', () => {
  const format = makeFormat({ sizeId: '5x7' });
  const el = { id: 'p', type: 'photo', x: 0, y: 0, w: 5, h: 7, rotation: 0, opacity: 1, slot: 0, mask: 'rect', radius: 0, frameStyle: 'none', shadow: false } as unknown as PhotoElement;
  // Manual framing at zoom 1 (smart crop may zoom in on faces after a turn).
  const landscape = { ...el, fill: fitFill(el, fill(), format) };
  const turned = { ...el, fill: fitFill(el, turnFill(landscape.fill!, 'cw'), format) };
  close(photoDpi(landscape)!, 4000 / 7, 1e-6);
  close(photoDpi(turned)!, 4000 / 5, 1e-6);
  // Auto framing still covers the frame after a turn.
  const auto = { ...el, fill: fitFill(el, turnFill(fitFill(el, fill({ crop: { cx: 0.5, cy: 0.5, zoom: 1, mode: 'auto' } }), format), 'cw'), format) };
  const oa = orientedFill(auto.fill!);
  const pa = placeImage(5, 7, oa.width, oa.height, auto.fill!.crop);
  assert.ok(pa.left <= 1e-9 && pa.top <= 1e-9 && pa.left + pa.width >= 5 - 1e-9 && pa.top + pa.height >= 7 - 1e-9);
  const o = orientedFill(turned.fill!);
  const pl = placeImage(5, 7, o.width, o.height, turned.fill!.crop);
  assert.ok(pl.left <= 1e-9 && pl.top <= 1e-9 && pl.left + pl.width >= 5 - 1e-9 && pl.top + pl.height >= 7 - 1e-9, 'still covers the frame');
  close(photoDpi(turned)!, effectiveDpi(5, 7, 4000, 6000, turned.fill!.crop.zoom));
});
