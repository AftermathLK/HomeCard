import path from 'node:path';
import AdmZip from 'adm-zip';
import { resolveStylePack } from '@homecard/shared';
import { safeJoin } from '../util/fsx';

/** Pack ids that belong to HomeCard itself and can never be imported. */
export const RESERVED_PACK_IDS = new Set(['stock-cache', 'my-uploads']);
export const MAX_UNZIPPED = 300 * 1024 * 1024;
const PACK_FILE = /\.(json|svg|png|jpe?g|webp|md|txt)$/i;

export interface PlannedPack {
  id: string;
  dest: string;
  files: Array<{ out: string; data: Buffer }>;
}

/**
 * Work out what importing a style-pack zip would write, without writing anything.
 *
 * A zip may hold one pack or a whole library (one folder per pack, like the layout library from
 * scripts/generate-mega-layouts.mjs). Each pack.json starts a pack; a pack.json inside another
 * pack's folder belongs to that pack. A pack with a bad manifest is reported and skipped, but an
 * unsafe path (zip-slip) or an archive that unpacks past MAX_UNZIPPED throws, so nothing from a
 * hostile archive is ever written.
 */
export function planZipImport(buf: Buffer, name: string, stylesDir: string, maxUnzipped = MAX_UNZIPPED) {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.startsWith('__MACOSX'));
  const manifests = entries
    .filter((e) => /(^|\/)(pack|style-pack|stylepack)\.json$/i.test(e.entryName))
    .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length || a.entryName.localeCompare(b.entryName))
    .map((e) => ({ e, prefix: e.entryName.slice(0, e.entryName.lastIndexOf('/') + 1) }))
    .filter((m, i, all) => !all.slice(0, i).some((o) => m.prefix.startsWith(o.prefix)));
  if (!manifests.length) throw new Error('Zip has no pack.json');

  const errors: Array<{ file: string; error: string }> = [];
  const planned: PlannedPack[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const { e: manifest, prefix } of manifests) {
    const label = manifests.length > 1 ? `${name} → ${prefix.replace(/\/$/, '') || 'pack.json'}` : name;
    let json: unknown;
    try {
      json = JSON.parse(manifest.getData().toString('utf8'));
    } catch (err: any) {
      errors.push({ file: label, error: `Could not parse ${manifest.entryName}: ${err.message}` });
      continue;
    }
    const r = resolveStylePack(json);
    if (!r.id) {
      errors.push({ file: label, error: r.errors.join(' ') || 'The pack has no id.' });
      continue;
    }
    if (RESERVED_PACK_IDS.has(r.id)) {
      errors.push({ file: label, error: `"${r.id}" is reserved — rename the pack id.` });
      continue;
    }
    if (ids.has(r.id)) {
      errors.push({ file: label, error: `Pack id "${r.id}" appears twice in this zip.` });
      continue;
    }
    ids.add(r.id);
    const dest = path.join(stylesDir, r.id);
    const files: PlannedPack['files'] = [];
    for (const e of entries) {
      if (!e.entryName.startsWith(prefix)) continue;
      const rel = e.entryName.slice(prefix.length);
      if (!rel || !PACK_FILE.test(rel)) continue;
      let out: string;
      try {
        out = safeJoin(dest, rel); // zip-slip protection
      } catch {
        throw new Error(`Unsafe path in zip: ${e.entryName}`);
      }
      // The declared size is checked before inflating; the real size is what counts.
      if (total + e.header.size > maxUnzipped) throw new Error(`Zip expands to more than ${Math.round(maxUnzipped / 1048576)} MB`);
      const data = e.getData();
      total += data.length;
      if (total > maxUnzipped) throw new Error(`Zip expands to more than ${Math.round(maxUnzipped / 1048576)} MB`);
      files.push({ out, data });
    }
    planned.push({ id: r.id, dest, files });
  }
  return { planned, errors };
}
