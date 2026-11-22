import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { duplicateProject, type CardProject } from '@homecard/shared';
import type { Actor } from '../auth/context';
import { ctxOf, decodableSource, parseRef } from '../media/sources';
import { findUserById } from '../security/users';
import { userUploadsDir } from '../storage/paths';
import { withEphemeral } from '../util/ephemeral';
import { ensureDir, exists, httpError } from '../util/fsx';
import { createProjectRecord, loadProject, thumbFile } from './store';

/**
 * "Share copy with another user".
 *
 * The recipient gets an independent copy of the card. Every photo that is PLACED on the card is
 * flattened into a plain sRGB JPEG (full resolution, EXIF/GPS/camera data stripped, generic file
 * name) and written into the recipient's own uploads folder. The copy then references those files
 * only — it never points at the sender's Immich library, private photo folder or uploads, and the
 * recipient's requests are always made with the recipient's own identity.
 * Photos that were only in the sender's tray (not placed) are not copied.
 */
export async function shareProjectCopy(sender: Actor, projectId: string, recipientId: string) {
  const recipient = findUserById(String(recipientId));
  if (!recipient || recipient.disabled) throw httpError(404, 'That person doesn’t have an active HomeCard account.');
  if (recipient.id === sender.userId) throw httpError(400, 'Choose someone other than yourself.');

  const src = await loadProject(sender.userId, projectId);
  const copy: CardProject = duplicateProject(src, src.name);
  copy.sharedFrom = { userId: sender.userId, displayName: sender.displayName, at: new Date().toISOString() };

  const placed: string[] = [];
  for (const s of copy.surfaces) for (const e of s.elements) if (e.type === 'photo' && e.fill && !placed.includes(e.fill.ref)) placed.push(e.fill.ref);

  const senderCtx = ctxOf(sender);
  const destRel = `shared-with-me/${copy.id}`;
  const destDir = path.join(userUploadsDir(recipient.id), destRel);
  const mapped = new Map<string, { ref: string; width: number; height: number }>();
  let flattened = 0;
  let skipped = 0;

  await withEphemeral('share', async (scope) => {
    for (const ref of placed) {
      try {
        const p = parseRef(ref, senderCtx);
        // Shared-folder photos are visible to everyone already: keep the reference.
        if (p.kind === 'library' && p.rel.startsWith('shared/')) {
          const fill = copy.surfaces.flatMap((s) => s.elements).find((e) => e.type === 'photo' && e.fill?.ref === ref);
          if (fill && fill.type === 'photo' && fill.fill) mapped.set(ref, { ref, width: fill.fill.width, height: fill.fill.height });
          continue;
        }
        const source = await decodableSource(ref, senderCtx, scope);
        // sharp writes no metadata unless asked: this drops EXIF (GPS, serials, dates) and XMP.
        const { data, info } = await sharp(source.path, { failOn: 'none', limitInputPixels: false })
          .rotate()
          .flatten({ background: '#ffffff' })
          .toColourspace('srgb')
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
          .withIccProfile('srgb')
          .toBuffer({ resolveWithObject: true });
        await ensureDir(destDir);
        const name = `photo-${String(++flattened).padStart(2, '0')}.jpg`;
        await fsp.writeFile(path.join(destDir, name), data, { mode: 0o640 });
        mapped.set(ref, { ref: `upload:${destRel}/${name}`, width: info.width, height: info.height });
      } catch {
        skipped++;
      }
    }
  });

  for (const s of copy.surfaces) {
    s.photoStash = [];
    for (const e of s.elements) {
      if (e.type !== 'photo' || !e.fill) continue;
      const m = mapped.get(e.fill.ref);
      if (!m) e.fill = null;
      else e.fill = { ...e.fill, ref: m.ref, width: m.width, height: m.height };
    }
  }
  let n = 0;
  copy.photos = copy.photos
    .filter((r) => mapped.has(r.ref))
    .map((r) => {
      const m = mapped.get(r.ref)!;
      return { ...r, ref: m.ref, width: m.width, height: m.height, name: m.ref.startsWith('upload:') ? `Photo ${++n}` : r.name, takenAt: null };
    });

  const created = await createProjectRecord(recipient.id, copy);
  if (await exists(thumbFile(sender.userId, projectId))) await fsp.copyFile(thumbFile(sender.userId, projectId), thumbFile(recipient.id, created.id)).catch(() => {});
  return { project: created, recipient: { id: recipient.id, displayName: recipient.display_name }, flattened, skipped };
}
