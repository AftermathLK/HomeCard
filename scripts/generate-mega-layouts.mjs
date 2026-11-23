// Generates the HomeCard mega layout library: 7 generic layout packs (0–6 photos) and one themed
// layout pack per occasion, validates every file, and zips them for /data/styles.
//
//   node --import tsx scripts/generate-mega-layouts.mjs [options]     (or: npm run layouts:mega -- …)
//
//   --per-occasion-count=12   themed layouts per photo count for each occasion (10–20)
//   --generic-count=50        generic layouts per photo count (10–80)
//   --out=dist/mega-layouts   where the pack folders are written (replaced on every run)
//   --zip=dist/homecard-mega-layouts.zip   zip path; --no-zip to skip it
//   --review=<dir>            also write schematic contact sheets (HTML) for a visual review
//
// The output is deterministic: the same options always produce the same files.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_ORNAMENTS, clearCustomTemplates, getTemplate, OCCASIONS, registerCustomTemplates, resolveStylePack, templateContext,
} from '../packages/shared/src/index.ts';
import { sanitizeSvg } from '../apps/server/src/styles/sanitize.ts';
import { ctxFor, ORIENTATIONS, toLayout, clipIssues, photoSignature, fullSignature } from './mega-layouts/engine.mjs';
import { beginBuild, builtZones, familiesFor } from './mega-layouts/families.mjs';
import { foilContrast, themeColors, GENERIC_DRESS, OCCASION_SETUP, occasionDress, occasionOrnaments } from './mega-layouts/occasions.mjs';
import { checkLayout, checkSvg, foilIssues, inkIssues, settleFoil, settleInk } from './mega-layouts/checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/server/package.json'));

/* ------------------------------ options ------------------------------ */

function options(argv) {
  const o = { perOccasion: 12, generic: 50, out: path.join(root, 'dist/mega-layouts'), zip: path.join(root, 'dist/homecard-mega-layouts.zip'), review: null };
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'per-occasion-count') o.perOccasion = Number(v);
    else if (k === 'generic-count') o.generic = Number(v);
    else if (k === 'out') o.out = path.resolve(v);
    else if (k === 'zip') o.zip = path.resolve(v);
    else if (k === 'no-zip') o.zip = null;
    else if (k === 'review') o.review = path.resolve(v || path.join(root, 'dist/mega-layouts-review'));
    else throw new Error(`Unknown option ${a}`);
  }
  if (!(o.perOccasion >= 10 && o.perOccasion <= 20)) throw new Error('--per-occasion-count must be 10–20');
  if (!(o.generic >= 10 && o.generic <= 80)) throw new Error('--generic-count must be 10–80');
  return o;
}

/* ------------------------------ helpers ------------------------------ */

const COUNTS = [0, 1, 2, 3, 4, 5, 6];
const CATS = ['full-bleed', 'framed', 'split', 'cutout', 'collage', 'typography', 'letter', 'postcard'];
// Share of each category in a set (generic and themed), by photo count.
const MIX0 = { typography: 12, framed: 9, split: 6, cutout: 6, 'full-bleed': 5, collage: 5, letter: 4, postcard: 3 };
const MIXN = { 'full-bleed': 8, framed: 8, split: 6, cutout: 6, collage: 9, typography: 5, letter: 4, postcard: 4 };

function quotas(n, total) {
  const mix = n === 0 ? MIX0 : MIXN;
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  const q = Object.fromEntries(CATS.map((c) => [c, Math.floor(((mix[c] ?? 0) * total) / sum)]));
  let left = total - Object.values(q).reduce((a, b) => a + b, 0);
  const order = CATS.slice().sort((a, b) => ((mix[b] * total) / sum - q[b]) - ((mix[a] * total) / sum - q[a]));
  for (let i = 0; left > 0; i++, left--) q[order[i % order.length]]++;
  return q;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
const pretty = (label) => label.split('-').filter((w) => !/^\d+$/.test(w)).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const plural = (n) => (n === 0 ? 'No photos' : n === 1 ? '1 photo' : `${n} photos`);

/** Interleave a family's variants so consecutive picks differ in several parameters. */
function spread(list, seed) {
  return list.map((v, i) => ({ v, k: hash(`${seed}:${i}`) })).sort((a, b) => a.k - b.k).map((x) => x.v);
}

/* ------------------------------ building ------------------------------ */

function candidatesFor(n) {
  const out = [];
  for (const fam of familiesFor(n)) {
    fam.variants.forEach((p, vi) => out.push({ fam, p, vi, key: `${fam.key}/${fam.label(p)}`, cat: fam.cat }));
  }
  return out;
}

const r2 = (v) => Math.round(v * 100);
/** Build all orientations with a dress. Returns null if any orientation fails the checks. */
function build(cand, dress, n, problems) {
  const layouts = {};
  let zoneSig = '';
  for (const o of ORIENTATIONS) {
    const c = ctxFor(o);
    beginBuild();
    let els;
    try {
      els = cand.fam.build(c, dress, cand.p);
    } catch (err) {
      problems.push(`${cand.key} [${o}]: build failed: ${err.message}`);
      return null;
    }
    const layout = settleInk(settleFoil(toLayout(c, els), dress.foilContrast), dress.themeColors);
    const issues = [...clipIssues(c, els), ...checkLayout(layout, n)];
    if (issues.length) {
      problems.push(`${cand.key} [${o}]: ${issues.join('; ')}`);
      return null;
    }
    layouts[o] = layout;
    if (o === 'portrait') zoneSig = skeleton(c, layout, n);
  }
  return { layouts, zoneSig, fullSig: ORIENTATIONS.map((o) => fullSignature(layouts[o])).join('|') };
}

/**
 * What a person would call "the same layout": the photo boxes plus where the text zones sit.
 * Photo-free cards have no photo boxes, so their type arrangement and panels count too.
 */
function skeleton(c, layout, n) {
  const zr = builtZones().map((z) => ({ ...z, f: [z.r.x / c.W, z.r.y / c.H, z.r.w / c.W, z.r.h / c.H] }));
  if (n > 0) {
    const zones = zr.map((z) => `${z.mode.startsWith('scrim') ? 'scrim' : z.mode}:${z.f.map(r2).join(',')}`).sort();
    return `${photoSignature(layout)}#${zones.join(';')}`;
  }
  // Photo-free: where the type sits and how it is aligned, the panels behind it and the artwork
  // around it (frames, corners, scatter). Swapping one text stack for another is not a new layout.
  const r5 = (v) => Math.round(v * 20);
  const inZone = (e) => {
    const cx = e.rect[0] + e.rect[2] / 2, cy = e.rect[1] + e.rect[3] / 2;
    return zr.some((z) => cx >= z.f[0] && cx <= z.f[0] + z.f[2] && cy >= z.f[1] && cy <= z.f[1] + z.f[3] && e.rect[2] < z.f[2] * 0.95);
  };
  const zones = zr.map((z) => `${z.mode}/${z.align}:${z.f.map(r5).join(',')}`).sort();
  const shapes = layout.filter((e) => e.type === 'shape' && e.shape !== 'line').map((e) => `${e.shape}:${e.rect.map(r5).join(',')}`).sort();
  const deco = layout.filter((e) => e.type === 'ornament' && !inZone(e)).map((e) => e.rect.map(r5).join(',')).sort();
  return `0#${zones.join(';')}#${shapes.join(';')}#${deco.join(';')}`;
}

function usesPackArt(layouts, packId) {
  return Object.values(layouts).every((els) => els.some((e) => e.type === 'ornament' && e.asset.startsWith(`pack:${packId}/`)));
}

/* ------------------------------ selection ------------------------------ */

function selectGeneric(n, total, problems) {
  const q = quotas(n, total);
  const pool = candidatesFor(n).filter((c) => c.p.mask !== 'heart');
  const picked = [];
  const zones = new Set();
  const take = (cand) => {
    const b = build(cand, GENERIC_DRESS, n, problems);
    if (!b || zones.has(b.zoneSig)) return false;
    zones.add(b.zoneSig);
    picked.push({ ...cand, ...b });
    return true;
  };
  const byCat = (cat) => {
    const fams = [...new Set(pool.filter((c) => c.cat === cat).map((c) => c.fam.key))];
    const queues = fams.map((f) => spread(pool.filter((c) => c.fam.key === f), `gen${n}${f}`));
    return queues;
  };
  let short = 0;
  for (const cat of CATS) {
    const queues = byCat(cat);
    let got = 0;
    while (got < q[cat] && queues.some((qq) => qq.length)) for (const qq of queues) if (got < q[cat] && qq.length && take(qq.shift())) got++;
    short += q[cat] - got;
  }
  // Fill any shortfall from every family in turn.
  if (short > 0) {
    const queues = [...new Set(pool.map((c) => c.fam.key))].map((f) => spread(pool.filter((c) => c.fam.key === f && !picked.some((p) => p.key === c.key)), `fill${n}${f}`));
    while (short > 0 && queues.some((qq) => qq.length)) for (const qq of queues) if (short > 0 && qq.length && take(qq.shift())) short--;
  }
  if (short > 0) throw new Error(`Only ${picked.length} generic ${n}-photo layouts available (wanted ${total})`);
  return { picked, zones };
}

/**
 * Themed picks for one occasion and photo count. Within what a person sees together (the generic
 * layouts plus this occasion's) every skeleton is different; between occasions skeletons may repeat
 * in a different dress, but the score spreads them so each occasion gets its own mix.
 */
function selectOccasion(n, setup, dress, packId, total, genericZones, zoneUse, problems, baseZone) {
  const q = quotas(n, total);
  const pool = candidatesFor(n).filter((c) => (c.p.mask !== 'heart' || setup.masks.includes('heart')) && !genericZones.has(baseZone(c)));
  const picked = [];
  const zones = new Set();
  const famCount = new Map();
  const builds = new Map();
  const built = (c) => {
    if (!builds.has(c.key)) builds.set(c.key, build(c, dress, n, problems));
    return builds.get(c.key);
  };
  const bigNumerals = (c) => !!built(c) && ORIENTATIONS.some((o) => built(c).layouts[o].some((e) => e.type === 'text' && e.role === 'year' && e.sizeRel >= 0.16));
  const score = (c) => {
    let s = (hash(`${setup.id}|${c.key}`) % 1000) / 1000; // stable variety between occasions
    if (c.p.mask && setup.masks.includes(c.p.mask)) s += 3;
    if (c.p.mask && !setup.masks.includes(c.p.mask) && c.fam.affinity.includes('mask')) s -= 2;
    if (setup.bigYear && bigNumerals(c)) s += 3;
    s -= 0.6 * (zoneUse.get(baseZone(c)) ?? 0);
    s -= 4 * (famCount.get(c.fam.key) ?? 0);
    return s;
  };
  const take = (cand) => {
    const b = built(cand);
    if (!b || zones.has(b.zoneSig) || zones.has(baseZone(cand))) return false;
    if (!usesPackArt(b.layouts, packId)) {
      problems.push(`${cand.key}: no ${setup.id} ornament`);
      return false;
    }
    zones.add(b.zoneSig).add(baseZone(cand));
    zoneUse.set(baseZone(cand), (zoneUse.get(baseZone(cand)) ?? 0) + 1);
    famCount.set(cand.fam.key, (famCount.get(cand.fam.key) ?? 0) + 1);
    picked.push({ ...cand, ...b });
    return true;
  };
  const tried = new Set();
  const fill = (cats, want) => {
    let got = 0;
    while (got < want) {
      const options = pool.filter((c) => cats.includes(c.cat) && !tried.has(c.key)).sort((a, b) => score(b) - score(a));
      if (!options.length) break;
      let ok = false;
      for (const c of options.slice(0, 40)) {
        tried.add(c.key);
        if (take(c)) { ok = true; break; }
      }
      if (ok) got++;
    }
    return got;
  };
  let short = 0;
  for (const cat of CATS) short += q[cat] - fill([cat], q[cat]);
  if (short > 0) short -= fill(CATS, short);
  if (short > 0) throw new Error(`${packId}: only ${picked.length} ${n}-photo layouts (wanted ${total})`);
  return picked;
}

/* ------------------------------ templates & packs ------------------------------ */

function templateJson(sel, prefix, n, index, occName = null) {
  const num = String(index + 1).padStart(2, '0');
  const base = `${prefix}-${n}p-${num}-`;
  const id = (base + slug(`${sel.fam.key}-${sel.fam.label(sel.p)}`)).slice(0, 64).replace(/-+$/, '');
  const labelWords = pretty(sel.fam.label(sel.p));
  const kinds = sel.fam.kinds ?? (n >= 2 && ['collage', 'framed', 'full-bleed', 'split'].includes(sel.cat) ? ['front', 'back'] : ['front']);
  return {
    id,
    name: `${sel.fam.title} · ${labelWords}`.slice(0, 48),
    description: `${occName ? `${occName} · ` : ''}${plural(n)} · ${sel.fam.title.toLowerCase()} (${labelWords.toLowerCase()}). Portrait, landscape and square versions.`,
    kinds,
    category: sel.cat,
    layouts: sel.layouts,
  };
}

function packManifest({ id, name, description, occasions, templates, ornaments }) {
  return {
    $schema: '../style-pack.schema.json',
    id,
    name,
    version: '1.0.0',
    author: 'HomeCard contributors',
    license: 'CC0-1.0',
    description,
    occasions,
    ...(ornaments?.length ? { ornaments: ornaments.map(({ id: oid, name: on, file, kind, stretch, tags }) => ({ id: oid, name: on, file, kind, ...(stretch ? { stretch: true } : {}), tags })) } : {}),
    templates,
  };
}

/* ------------------------------ validation ------------------------------ */

function validateOutput(outDir, packs, existing) {
  const errors = [];
  const Ajv2020 = require('ajv/dist/2020').default;
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'data/styles/style-pack.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const builtin = new Set(BUILTIN_ORNAMENTS.map((o) => o.id));
  const packIds = new Set();
  const fullIds = new Set(existing.templateIds);
  clearCustomTemplates();
  let checkedLayouts = 0, checkedSvgs = 0, built = 0;
  try {
    for (const { id, n } of packs) {
      const dir = path.join(outDir, id);
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
      if (!validate(raw)) errors.push(`${id}: schema: ${ajv.errorsText(validate.errors)}`);
      if (raw.id !== id) errors.push(`${id}: id does not match its folder`);
      // Foil must read against the default theme of the pack's occasion (generic packs carry none).
      const foilC = raw.occasions?.length ? foilContrast(raw.occasions[0]) : null;
      const inkC = raw.occasions?.length ? themeColors(raw.occasions[0]) : null;
      if (packIds.has(id) || existing.packIds.has(id)) errors.push(`${id}: duplicate pack id`);
      packIds.add(id);
      const pack = resolveStylePack(raw, 'pack');
      if (pack.errors.length) errors.push(`${id}: ${pack.errors.join('; ')}`);
      const declared = new Set(pack.ornaments.map((o) => o.asset));
      for (const o of pack.ornaments) {
        const abs = path.join(dir, o.file);
        if (!fs.existsSync(abs)) { errors.push(`${id}: missing ${o.file}`); continue; }
        const src = fs.readFileSync(abs, 'utf8');
        for (const p of checkSvg(src)) errors.push(`${id}/${o.file}: ${p}`);
        try { sanitizeSvg(src, o.asset); } catch (err) { errors.push(`${id}/${o.file}: sanitizer: ${err.message}`); }
        checkedSvgs++;
      }
      registerCustomTemplates(pack.templates, id);
      const local = new Set();
      for (const t of raw.templates) {
        const full = `${id}:${t.id}`;
        if (local.has(t.id) || fullIds.has(full)) errors.push(`${full}: duplicate template id`);
        local.add(t.id);
        fullIds.add(full);
        const want = n ?? (Number(/-(\d)p-/.exec(t.id)?.[1]));
        for (const o of ORIENTATIONS) {
          const els = t.layouts[o];
          if (!els) { errors.push(`${full}: no ${o} layout`); continue; }
          for (const p of checkLayout(els, want)) errors.push(`${full} [${o}]: ${p}`);
          for (const p of foilIssues(els, foilC)) errors.push(`${full} [${o}]: ${p}`);
          for (const p of inkIssues(els, inkC)) errors.push(`${full} [${o}]: ${p}`);
          for (const e of els) {
            if (e.type !== 'ornament') continue;
            if (e.asset.startsWith('pack:')) {
              if (!e.asset.startsWith(`pack:${id}/`)) errors.push(`${full}: refers to another pack (${e.asset})`);
              else if (!declared.has(e.asset)) errors.push(`${full}: undeclared ornament ${e.asset}`);
            } else if (e.asset !== '@icon' && !builtin.has(e.asset)) errors.push(`${full}: unknown ornament ${e.asset}`);
          }
          checkedLayouts++;
        }
        const def = getTemplate(full);
        if (def.id !== full) { errors.push(`${full}: did not register`); continue; }
        if (def.photos !== want) errors.push(`${full}: registers ${def.photos} photos, expected ${want}`);
        for (const [w, h] of [[5, 7], [7, 5], [5, 5], [4, 8], [4.25, 5.5], [6, 8]]) {
          const els = def.build(templateContext({ widthIn: w, heightIn: h, bleedIn: 0.125, safeIn: 0.25 }, def.defaults));
          const slots = [...new Set(els.filter((e) => e.type === 'photo').map((e) => e.slot))].sort((a, b) => a - b);
          if (slots.length !== want || slots.some((s, i) => s !== i)) errors.push(`${full} at ${w}×${h}: slots ${slots}`);
          if (els.some((e) => ![e.x, e.y, e.w, e.h].every(Number.isFinite) || e.w <= 0 || e.h <= 0)) errors.push(`${full} at ${w}×${h}: bad geometry`);
          built++;
        }
      }
    }
  } finally {
    clearCustomTemplates();
  }
  return { errors, checkedLayouts, checkedSvgs, built };
}

function existingIds() {
  const dir = path.join(root, 'data/styles');
  const packIds = new Set(['stock-cache', 'my-uploads', '_uploads']);
  const templateIds = new Set();
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name, 'pack.json');
    if (!fs.existsSync(f)) continue;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    packIds.add(raw.id);
    for (const t of raw.templates ?? []) if (typeof t === 'object') templateIds.add(`${raw.id}:${t.id}`);
  }
  return { packIds, templateIds };
}

/* ------------------------------ zip & review ------------------------------ */

function writeZip(outDir, zipPath, packIds) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  // Fixed entry times and order keep the zip byte-for-byte identical between runs.
  const when = new Date(2026, 0, 1);
  const add = (dir, rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(path.join(dir, r)).isDirectory()) add(dir, r);
      else {
        zip.addFile(r, fs.readFileSync(path.join(dir, r)));
        zip.getEntry(r).header.time = when;
      }
    }
  };
  for (const id of packIds) add(outDir, id);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  zip.writeZip(zipPath);
  return fs.statSync(zipPath).size;
}

function reviewSheets(dir, packs) {
  fs.mkdirSync(dir, { recursive: true });
  const col = { photo: '#9fb3c8', scrim: 'url(#scr)', shape: '#e9dfcf' };
  const draw = (els, W, H) => {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 26}" height="${H * 26}"><defs><linearGradient id="scr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="#fbf8f3" stroke="#bbb" stroke-width=".02"/>`;
    for (const e of els) {
      const [x, y, w, h] = [e.rect[0] * W, e.rect[1] * H, e.rect[2] * W, e.rect[3] * H];
      const tf = e.rotation ? ` transform="rotate(${e.rotation} ${x + w / 2} ${y + h / 2})"` : '';
      if (e.type === 'photo') {
        const rx = e.mask === 'circle' || e.mask === 'ellipse' ? `rx="${w / 2}" ry="${h / 2}"` : e.mask === 'rounded' ? 'rx=".15"' : e.mask === 'arch' ? `rx="${w / 2}"` : '';
        const fr = e.frameStyle === 'polaroid' ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#999" stroke-width=".02"${tf}/>` : '';
        s += fr + `<rect x="${x + (fr ? w * 0.06 : 0)}" y="${y + (fr ? w * 0.06 : 0)}" width="${w - (fr ? w * 0.12 : 0)}" height="${h - (fr ? Math.min(h * 0.3, w * 0.22) + w * 0.06 : 0)}" ${rx} fill="${col.photo}"${tf}/><text x="${x + w / 2}" y="${y + h / 2}" font-size=".3" text-anchor="middle" fill="#fff"${tf}>${e.slot}</text>`;
      } else if (e.type === 'scrim') s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" opacity=".22"/>`;
      else if (e.type === 'shape') s += e.shape === 'line' ? `<rect x="${x}" y="${y + h / 2 - 0.01}" width="${w}" height=".02" fill="#b08d57"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${e.shape === 'ellipse' ? `rx="${w / 2}" ry="${h / 2}"` : ''} fill="${e.fill === '@text' ? '#3b3733' : e.fill === '@accent' ? '#c9a54a' : '#efe6d6'}" opacity="${e.opacity ?? 1}"${tf}/>`;
      else if (e.type === 'ornament') s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#b08d57" stroke-width=".02" stroke-dasharray=".06 .05"${tf}/>`;
      else if (e.type === 'text') s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${e.color === '@onPhoto' || e.color === '@background' ? '#fff' : '#c0392b'}" stroke-width=".02"/><text x="${x + w / 2}" y="${y + h / 2 + 0.07}" font-size="${Math.min(0.22, h * 0.6)}" text-anchor="middle" fill="${e.color === '@onPhoto' || e.color === '@background' ? '#fff' : '#c0392b'}">${e.role}</text>`;
    }
    return s + '</svg>';
  };
  for (const { id, raw } of packs) {
    let html = `<!doctype html><meta charset="utf-8"><title>${id}</title><style>body{font:12px system-ui;background:#eee;margin:16px}div.t{display:inline-block;vertical-align:top;margin:6px;padding:6px;background:#fff;border-radius:6px;width:470px}svg{margin:2px}</style><h2>${raw.name}</h2>`;
    for (const t of raw.templates) html += `<div class="t"><b>${t.id}</b><br>${t.name} · ${t.category}<br>${draw(t.layouts.portrait, 5, 7)}${draw(t.layouts.landscape, 7, 5)}${draw(t.layouts.square, 5, 5)}</div>`;
    fs.writeFileSync(path.join(dir, `${id}.html`), html);
  }
}

/* ------------------------------ main ------------------------------ */

export { candidatesFor, build };

export function generate(opts) {
  const started = Date.now();
  const occasionNames = new Map(OCCASIONS.map((o) => [o.id, o.name]));
  // The occasion list must match the app exactly.
  const ids = OCCASION_SETUP.map((o) => o.id);
  const missing = [...occasionNames.keys()].filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !occasionNames.has(id));
  if (missing.length || extra.length) throw new Error(`Occasion list out of date (missing: ${missing}; unknown: ${extra})`);

  const problems = [];
  const zoneUse = new Map();
  const genericZones = {};
  const packs = [];

  // Generic packs, one per photo count.
  for (const n of COUNTS) {
    const { picked, zones } = selectGeneric(n, opts.generic, problems);
    genericZones[n] = zones;
    const id = `layouts-generic-${n}p`;
    const templates = picked.map((s, i) => templateJson(s, 'gen', n, i));
    packs.push({
      id, n, raw: packManifest({
        id, name: `Layout Library · ${plural(n)}`, occasions: [],
        description: `${templates.length} generic ${n === 0 ? 'photo-free' : `${n}-photo`} layouts for every occasion, each with portrait, landscape and square versions.`,
        templates,
      }), ornaments: [],
    });
  }

  // Skeleton of a candidate in the neutral dress (cached): compares themed picks with generic ones.
  const zoneCache = new Map();
  const baseZone = (n) => (c) => {
    const k = `${n}/${c.key}`;
    if (!zoneCache.has(k)) zoneCache.set(k, build(c, GENERIC_DRESS, n, [])?.zoneSig ?? `x:${k}`);
    return zoneCache.get(k);
  };

  // Themed packs, one per occasion.
  for (const setup of OCCASION_SETUP) {
    const id = `layouts-${setup.id}`;
    const dress = occasionDress(setup, id);
    const ornaments = occasionOrnaments(setup, occasionNames.get(setup.id).replace(/’/g, "'"));
    const templates = [];
    for (const n of COUNTS) {
      const picked = selectOccasion(n, setup, dress, id, opts.perOccasion, genericZones[n], zoneUse, problems, baseZone(n));
      templates.push(...picked.map((s, i) => templateJson(s, setup.code, n, i, occasionNames.get(setup.id))));
    }
    const name = occasionNames.get(setup.id);
    packs.push({
      id, n: null, raw: packManifest({
        id, name: `${name} Layouts`, occasions: [setup.id],
        description: `${templates.length} ${name} layouts for 0–6 photos with ${name} ornaments, each with portrait, landscape and square versions.`,
        templates, ornaments,
      }), ornaments,
    });
  }

  // Write.
  fs.rmSync(opts.out, { recursive: true, force: true });
  for (const p of packs) {
    const dir = path.join(opts.out, p.id);
    fs.mkdirSync(path.join(dir, 'ornaments'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(p.raw) + '\n');
    for (const o of p.ornaments) fs.writeFileSync(path.join(dir, o.file), o.svg);
    if (!p.ornaments.length) fs.rmdirSync(path.join(dir, 'ornaments'));
  }

  const v = validateOutput(opts.out, packs, existingIds());
  const zipSize = opts.zip && !v.errors.length ? writeZip(opts.out, opts.zip, packs.map((p) => p.id)) : null;
  if (opts.review) reviewSheets(opts.review, packs);
  return { packs, problems, validation: v, zipSize, ms: Date.now() - started };
}

function summary(res, opts) {
  const { packs, validation: v } = res;
  const all = packs.flatMap((p) => p.raw.templates.map((t) => ({ ...t, pack: p.id, n: Number(/-(\d)p-/.exec(t.id)[1]), generic: p.id.startsWith('layouts-generic') })));
  const line = (cells, w) => cells.map((c, i) => String(c).padStart(i ? w[i] : 0).padEnd(i ? 0 : w[0])).join('  ');
  console.log('\nTemplates per photo count');
  const w1 = [8, 8, 10, 7];
  console.log(line(['photos', 'generic', 'occasion', 'total'], w1));
  for (const n of COUNTS) {
    const g = all.filter((t) => t.n === n && t.generic).length, o = all.filter((t) => t.n === n && !t.generic).length;
    console.log(line([n, g, o, g + o], w1));
  }
  console.log(line(['all', all.filter((t) => t.generic).length, all.filter((t) => !t.generic).length, all.length], w1));

  console.log('\nTemplates per category and photo count');
  const w2 = [11, ...COUNTS.map(() => 5), 7];
  console.log(line(['category', ...COUNTS.map((n) => `${n}p`), 'total'], w2));
  for (const cat of CATS) console.log(line([cat, ...COUNTS.map((n) => all.filter((t) => t.n === n && t.category === cat).length), all.filter((t) => t.category === cat).length], w2));

  console.log('\nOccasion packs');
  const w3 = [28, 10, 10];
  console.log(line(['pack', 'layouts', 'ornaments'], w3));
  for (const p of packs.filter((pp) => !pp.id.startsWith('layouts-generic'))) console.log(line([p.id, p.raw.templates.length, p.ornaments.length], w3));

  const bigYear = (p) => p.raw.templates.filter((t) => ORIENTATIONS.some((o) => t.layouts[o].some((e) => e.type === 'text' && e.role === 'year' && e.sizeRel >= 0.16))).length;
  const yearPacks = packs.filter((p) => OCCASION_SETUP.find((o) => `layouts-${o.id}` === p.id)?.bigYear);
  console.log(`\nBig year numerals (sizeRel ≥ 0.16, {{year}} token): ${yearPacks.map((p) => `${p.id} ${bigYear(p)}/${p.raw.templates.length}`).join(', ')}`);

  console.log(`\nValidation: ${v.errors.length ? `${v.errors.length} ERRORS` : 'OK'} — ${packs.length} packs, ${all.length} templates, ${v.checkedLayouts} layouts, ${v.built} engine builds, ${v.checkedSvgs} SVGs`);
  for (const e of v.errors.slice(0, 40)) console.log('  ✗ ' + e);
  console.log(`Candidates rejected while selecting: ${res.problems.length}`);
  console.log(`Output: ${opts.out}`);
  if (res.zipSize != null) console.log(`ZIP: ${opts.zip} (${(res.zipSize / 1024 / 1024).toFixed(2)} MB)`);
  else if (opts.zip) console.log('ZIP: not written (validation failed)');
  console.log(`Done in ${(res.ms / 1000).toFixed(1)} s`);
}

if (import.meta.main) {
  const opts = options(process.argv.slice(2));
  const res = generate(opts);
  summary(res, opts);
  if (process.env.MEGA_DEBUG) for (const p of res.problems.slice(0, Number(process.env.MEGA_DEBUG) || 60)) console.log('  · ' + p);
  if (res.validation.errors.length) process.exitCode = 1;
}
