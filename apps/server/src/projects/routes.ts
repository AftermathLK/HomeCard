import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { CardProject } from '@homecard/shared';
import { clientIp, userOf, type Actor } from '../auth/context';
import { emitTo } from '../events';
import { renderThumbnail } from '../render/exporter';
import { audit } from '../security/audit';
import { findUserById } from '../security/users';
import { exists, httpError } from '../util/fsx';
import { shareProjectCopy } from './share';
import {
  assertOwner,
  createProjectRecord,
  deleteProject,
  duplicate,
  listProjects,
  listVersions,
  loadProject,
  loadVersion,
  restoreVersion,
  saveProject,
  snapshot,
  thumbFile,
} from './store';

/* Debounced thumbnail regeneration after saves (renders the front at screen resolution). */
const pending = new Map<string, NodeJS.Timeout>();
let thumbChain: Promise<void> = Promise.resolve();

export function scheduleThumbnail(userId: string, id: string, delay = 4000) {
  const key = `${userId}:${id}`;
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      thumbChain = thumbChain.then(async () => {
        try {
          const u = findUserById(userId);
          if (!u) return;
          const p = await loadProject(userId, id);
          await renderThumbnail(p, thumbFile(userId, id), { userId, username: u.username, displayName: u.display_name, role: u.role });
          emitTo(userId, 'project-thumb', { id, at: Date.now() });
        } catch (err: any) {
          if (!/not found/i.test(String(err?.message))) console.warn(`[thumb] ${id}: ${err?.message ?? err}`);
        }
      });
    }, delay),
  );
}

const owner = (a: Actor) => ({ userId: a.userId, username: a.username, displayName: a.displayName, role: a.role });

export function registerProjectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async (req) => listProjects(userOf(req).userId));

  app.post<{ Body: CardProject }>('/api/projects', async (req) => {
    const me = userOf(req);
    const body = { ...req.body, sharedFrom: null };
    const p = await createProjectRecord(me.userId, body);
    scheduleThumbnail(me.userId, p.id, 500);
    emitTo(me.userId, 'projects', { id: p.id });
    return p;
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => loadProject(userOf(req).userId, req.params.id));

  app.put<{ Params: { id: string }; Body: CardProject }>('/api/projects/:id', async (req) => {
    const me = userOf(req);
    const current = await loadProject(me.userId, req.params.id);
    // "sharedFrom" is set by the server only.
    const p = await saveProject(me.userId, req.params.id, { ...req.body, sharedFrom: current.sharedFrom ?? null });
    scheduleThumbnail(me.userId, p.id);
    return { id: p.id, updatedAt: p.updatedAt };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const me = userOf(req);
    await deleteProject(me.userId, req.params.id);
    emitTo(me.userId, 'projects', { id: req.params.id, deleted: true });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/projects/:id/duplicate', async (req) => {
    const me = userOf(req);
    const p = await duplicate(me.userId, req.params.id, req.body?.name);
    scheduleThumbnail(me.userId, p.id, 500);
    emitTo(me.userId, 'projects', { id: p.id });
    return p;
  });

  /** Copy this card (with its placed photos flattened) into another user's workspace. */
  app.post<{ Params: { id: string }; Body: { recipientId?: string } }>('/api/projects/:id/share', async (req) => {
    const me = userOf(req);
    assertOwner(me.userId, req.params.id);
    const r = await shareProjectCopy(me, req.params.id, String(req.body?.recipientId ?? ''));
    emitTo(r.recipient.id, 'projects', { id: r.project.id, sharedBy: me.displayName });
    scheduleThumbnail(r.recipient.id, r.project.id, 1500);
    audit({ event: 'project.shared', userId: me.userId, username: me.username, ip: clientIp(req), detail: { project: req.params.id, to: findUserById(r.recipient.id)?.username, photos: r.flattened, skipped: r.skipped } });
    return { ok: true, recipient: r.recipient.displayName, photos: r.flattened, skipped: r.skipped };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/versions', async (req) => {
    const me = userOf(req);
    assertOwner(me.userId, req.params.id);
    return listVersions(me.userId, req.params.id);
  });

  app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/projects/:id/versions', async (req) => {
    const me = userOf(req);
    const p = await loadProject(me.userId, req.params.id);
    const label = String(req.body?.label ?? '').trim().slice(0, 80) || 'Snapshot';
    return snapshot(me.userId, req.params.id, p, label, false);
  });

  app.get<{ Params: { id: string; vid: string } }>('/api/projects/:id/versions/:vid', async (req) => loadVersion(userOf(req).userId, req.params.id, req.params.vid));

  app.post<{ Params: { id: string; vid: string } }>('/api/projects/:id/versions/:vid/restore', async (req) => {
    const me = userOf(req);
    const p = await restoreVersion(me.userId, req.params.id, req.params.vid);
    scheduleThumbnail(me.userId, p.id, 500);
    return p;
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/thumbnail', async (req, reply) => {
    const me = userOf(req);
    assertOwner(me.userId, req.params.id);
    const f = thumbFile(me.userId, req.params.id);
    if (!(await exists(f))) {
      scheduleThumbnail(me.userId, req.params.id, 0);
      throw httpError(404, 'Thumbnail not generated yet');
    }
    const st = await fsp.stat(f);
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('Last-Modified', st.mtime.toUTCString());
    return reply.type('image/jpeg').send(createReadStream(f));
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/thumbnail', async (req) => {
    const me = userOf(req);
    const p = await loadProject(me.userId, req.params.id);
    await renderThumbnail(p, thumbFile(me.userId, p.id), owner(me));
    emitTo(me.userId, 'project-thumb', { id: p.id, at: Date.now() });
    return { ok: true };
  });
}
