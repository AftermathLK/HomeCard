import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ExportOptions } from '@homecard/shared';
import { clientIp, userOf } from '../auth/context';
import { loadProject } from '../projects/store';
import { audit } from '../security/audit';
import { httpError, safeJoin } from '../util/fsx';
import { deleteExport, exportFolderAbs, getExport, listExports, loadExportIndex, startExport } from './exporter';
import { iccProfiles } from './ghostscript';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

/** Per-user guard: one person can't queue dozens of 600 DPI renders at once. */
const MAX_QUEUED_PER_USER = 3;

/**
 * Exports. Every route resolves the export through the signed-in user's own records; another
 * user's export id is indistinguishable from one that doesn't exist (404).
 */
export function registerExportRoutes(app: FastifyInstance) {
  app.post<{ Body: { projectId: string; options: Partial<ExportOptions> } }>('/api/exports', async (req) => {
    const me = userOf(req);
    const { projectId, options } = req.body ?? ({} as any);
    if (!projectId) throw httpError(400, 'projectId required');
    if (options?.format && !['png', 'jpeg', 'pdf', 'share'].includes(options.format)) throw httpError(400, 'Unknown export format');
    const project = await loadProject(me.userId, String(projectId));
    await loadExportIndex();
    const active = listExports(me.userId).filter((r) => r.status === 'queued' || r.status === 'rendering').length;
    if (active >= MAX_QUEUED_PER_USER) {
      throw httpError(429, 'You already have several exports rendering. Wait for one to finish.');
    }
    const rec = await startExport(project, options ?? {}, { userId: me.userId, username: me.username, displayName: me.displayName, role: me.role });
    audit({ event: 'export.created', userId: me.userId, username: me.username, ip: clientIp(req), detail: { export: rec.id, project: project.id, format: rec.options.format, dpi: rec.options.dpi } });
    return rec;
  });

  app.get<{ Querystring: { projectId?: string } }>('/api/exports', async (req) => {
    const me = userOf(req);
    await loadExportIndex();
    return listExports(me.userId, req.query.projectId ? String(req.query.projectId) : undefined);
  });

  app.get<{ Params: { id: string } }>('/api/exports/:id', async (req) => {
    const me = userOf(req);
    await loadExportIndex();
    const rec = getExport(me.userId, req.params.id);
    if (!rec) throw httpError(404, 'Export not found');
    return rec;
  });

  app.get<{ Params: { id: string; name: string }; Querystring: { download?: string } }>('/api/exports/:id/files/:name', async (req, reply) => {
    const me = userOf(req);
    await loadExportIndex();
    const rec = getExport(me.userId, req.params.id);
    if (!rec) throw httpError(404, 'Export not found');
    const file = rec.files.find((f) => f.name === req.params.name);
    if (!file) throw httpError(404, 'File not found');
    const abs = safeJoin(exportFolderAbs(me.userId, rec), file.name);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) throw httpError(410, 'File was removed from disk');
    reply.header('Content-Length', String(st.size));
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    if (req.query.download) reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    return reply.type(MIME[path.extname(file.name).toLowerCase()] ?? 'application/octet-stream').send(createReadStream(abs));
  });

  app.get<{ Params: { id: string; name: string } }>('/api/exports/:id/proof/:name', async (req, reply) => {
    const me = userOf(req);
    await loadExportIndex();
    const rec = getExport(me.userId, req.params.id);
    if (!rec) throw httpError(404, 'Export not found');
    if (!/^page-\d+\.jpg$/.test(req.params.name)) throw httpError(400, 'Bad proof name');
    const abs = safeJoin(path.join(exportFolderAbs(me.userId, rec), '.proof'), req.params.name);
    if (!(await fsp.stat(abs).catch(() => null))) throw httpError(404, 'Proof not found');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.type('image/jpeg').send(createReadStream(abs));
  });

  app.delete<{ Params: { id: string } }>('/api/exports/:id', async (req) => {
    const me = userOf(req);
    await loadExportIndex();
    const rec = await deleteExport(me.userId, req.params.id);
    if (!rec) throw httpError(404, 'Export not found');
    audit({ event: 'export.deleted', userId: me.userId, username: me.username, ip: clientIp(req), detail: { export: rec.id, project: rec.projectId } });
    return { ok: true };
  });

  app.get('/api/icc-profiles', async (req) => {
    userOf(req);
    return (await iccProfiles()).map(({ path: _p, ...rest }) => rest);
  });
}
