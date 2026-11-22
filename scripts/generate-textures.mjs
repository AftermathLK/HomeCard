// Generates the starter-kit paper/background textures procedurally (no third-party images, so the
// starter kit is fully redistributable). Output goes into data/styles/<pack>/textures/.
// Textures are generated at 300 DPI for their physical tile size so they print sharp.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/server/package.json'));
const sharp = require('sharp');

/* Deterministic PRNG + value noise */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise: lattice wraps at `period` cells. */
function makeNoise(seed, period) {
  const r = rng(seed);
  const g = new Float32Array(period * period).map(() => r());
  const at = (x, y) => g[((y % period) + period) % period * period + (((x % period) + period) % period)];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = sm(x - xi), ty = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function fbm(noise, x, y, octaves, period) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise((x * f) % (period * f), (y * f) % (period * f));
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

async function writeTexture(file, w, h, channels, fill) {
  const data = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fill(x, y, data, (y * w + x) * channels);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let img = sharp(data, { raw: { width: w, height: h, channels } }).withMetadata({ density: 300 });
  img = file.endsWith('.png') ? img.png({ compressionLevel: 9, palette: false }) : img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' });
  await img.toFile(file);
  console.log(`  ${path.relative(root, file)} ${w}x${h}`);
}

const out = (pack, name) => path.join(root, 'data/styles', pack, 'textures', name);
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/* 1. Linen weave overlay (transparent PNG, 2in tile @300dpi) */
{
  const S = 600, n = makeNoise(11, 300), n2 = makeNoise(12, 600);
  await writeTexture(out('classic-paper', 'linen.png'), S, S, 4, (x, y, d, i) => {
    const warp = n(x * 0.5, y * 0.04) - 0.5;
    const weft = n(x * 0.04 + 50, y * 0.5) - 0.5;
    const fine = n2(x, y) - 0.5;
    const v = warp * 0.6 + weft * 0.6 + fine * 0.35;
    const dark = v < 0;
    d[i] = d[i + 1] = d[i + 2] = dark ? 60 : 255;
    d[i + 3] = clamp(Math.abs(v) * 120);
  });
}

/* 2. Cardstock fiber grain overlay (transparent PNG) */
{
  const S = 600, n = makeNoise(21, 75), r = rng(22);
  await writeTexture(out('classic-paper', 'cardstock-grain.png'), S, S, 4, (x, y, d, i) => {
    const cloud = fbm(n, x / 8, y / 8, 4, 75) - 0.5;
    const speck = r() < 0.004 ? 0.6 : 0;
    const v = cloud * 0.5 + (r() - 0.5) * 0.25 - speck;
    d[i] = d[i + 1] = d[i + 2] = v < 0 ? 70 : 255;
    d[i + 3] = clamp(Math.abs(v) * 110);
  });
}

/* 3. Watercolor paper wash (opaque JPEG, cover mode, 6x6in @ 150dpi upscaled smoothly by cover) */
{
  const S = 1200, n = makeNoise(31, 40), n2 = makeNoise(32, 160);
  await writeTexture(out('classic-paper', 'watercolor-wash.jpg'), S, S, 3, (x, y, d, i) => {
    const wash = fbm(n, x / 30, y / 30, 5, 40);
    const tooth = n2(x / 3, y / 3) - 0.5;
    const t = Math.max(0, Math.min(1, (wash - 0.35) * 1.8));
    const base = [252, 249, 243], tint = [232, 222, 236];
    for (let c = 0; c < 3; c++) d[i + c] = clamp(base[c] + (tint[c] - base[c]) * t * 0.7 + tooth * 10);
  });
}

/* 4. Kraft paper (opaque JPEG tile, 3in @300dpi) */
{
  const S = 900, n = makeNoise(41, 225), r = rng(42);
  await writeTexture(out('classic-paper', 'kraft.jpg'), S, S, 3, (x, y, d, i) => {
    const fib = fbm(n, x / 4, y / 4, 4, 225) - 0.5;
    const streak = n(x * 0.9, y * 0.06) - 0.5;
    const fleck = r() < 0.003 ? -40 : r() < 0.002 ? 25 : 0;
    const v = fib * 30 + streak * 14 + fleck;
    d[i] = clamp(190 + v);
    d[i + 1] = clamp(152 + v * 0.85);
    d[i + 2] = clamp(108 + v * 0.7);
  });
}

/* 5. Dark pine velvet (opaque JPEG tile for winter cards) */
{
  const S = 600, n = makeNoise(51, 150);
  await writeTexture(out('winter-woodland', 'pine-velvet.jpg'), S, S, 3, (x, y, d, i) => {
    const v = fbm(n, x / 4, y / 4, 5, 150) - 0.5;
    d[i] = clamp(22 + v * 18);
    d[i + 1] = clamp(56 + v * 26);
    d[i + 2] = clamp(44 + v * 20);
  });
}

/* 6. Snowfall overlay (transparent PNG tile, 3in) */
{
  const S = 900, r = rng(61);
  const flakes = Array.from({ length: 140 }, () => ({ x: r() * S, y: r() * S, rad: 1.5 + r() * r() * 9, a: 0.35 + r() * 0.6 }));
  await writeTexture(out('winter-woodland', 'snowfall.png'), S, S, 4, (x, y, d, i) => {
    let a = 0;
    for (const f of flakes) {
      // wrap-around distance so the tile is seamless
      let dx = Math.abs(x - f.x), dy = Math.abs(y - f.y);
      if (dx > S / 2) dx = S - dx;
      if (dy > S / 2) dy = S - dy;
      if (dx > f.rad + 2 || dy > f.rad + 2) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const v = Math.max(0, Math.min(1, f.rad + 0.8 - dist)) * f.a;
      if (v > a) a = v;
    }
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = clamp(a * 255);
  });
}

/* 7. Gold bokeh (opaque JPEG, cover) */
{
  const W = 1500, H = 1500, r = rng(71);
  const dots = Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, rad: 20 + r() * 90, a: 0.15 + r() * 0.45, warm: r() }));
  await writeTexture(out('gilded-holiday', 'gold-bokeh.jpg'), W, H, 3, (x, y, d, i) => {
    let R = 26, G = 20, B = 14;
    const vg = 1 - 0.35 * Math.hypot((x - W / 2) / W, (y - H / 2) / H);
    for (const p of dots) {
      const dx = x - p.x, dy = y - p.y;
      if (Math.abs(dx) > p.rad || Math.abs(dy) > p.rad) continue;
      const dist = Math.sqrt(dx * dx + dy * dy) / p.rad;
      if (dist > 1) continue;
      const edge = dist > 0.85 ? 1.3 : 1;
      const k = p.a * edge * (1 - dist * 0.35);
      R += k * (230 + 25 * p.warm);
      G += k * (170 + 30 * p.warm);
      B += k * (80 + 20 * p.warm);
    }
    d[i] = clamp(R * vg);
    d[i + 1] = clamp(G * vg);
    d[i + 2] = clamp(B * vg);
  });
}

/* 8. Fine film grain overlay used by the "grain" photo polish (transparent PNG, 1in tile) */
{
  const S = 300, r = rng(81);
  const dir = path.join(root, 'apps/web/public/textures');
  fs.mkdirSync(dir, { recursive: true });
  await writeTexture(path.join(dir, 'grain.png'), S, S, 4, (x, y, d, i) => {
    const v = (r() + r() + r()) / 3 - 0.5;
    d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : 255;
    d[i + 3] = clamp(Math.abs(v) * 2 * 160);
  });
}

/* 9. Blush watercolor (spring) */
{
  const S = 1200, n = makeNoise(91, 30);
  await writeTexture(out('spring-garden', 'blush-wash.jpg'), S, S, 3, (x, y, d, i) => {
    const wash = fbm(n, x / 40, y / 40, 5, 30);
    const t = Math.max(0, Math.min(1, (wash - 0.3) * 1.6));
    const base = [253, 248, 245], tint = [246, 214, 214];
    for (let c = 0; c < 3; c++) d[i + c] = clamp(base[c] + (tint[c] - base[c]) * t);
  });
}

console.log('generate-textures: done');
