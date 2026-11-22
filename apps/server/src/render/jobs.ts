import type { FastifyInstance } from 'fastify';
import { uid, type RenderJob } from '@homecard/shared';
import { httpError } from '../util/fsx';
import type { EphemeralScope } from '../util/ephemeral';
import { issueGrant, revokeGrant, type RenderGrant } from './grants';

/**
 * Short-lived, in-memory render jobs consumed by /render.html. Each job carries a render grant
 * (its own random token) bound to the job's owner; the renderer can read nothing else.
 */
const jobs = new Map<string, { job: RenderJob; grant: RenderGrant; expires: number }>();
const TTL = 15 * 60_000;

export interface JobOwner {
  userId: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

export function putJob(job: Omit<RenderJob, 'id' | 'createdAt'>, owner: JobOwner, scope: EphemeralScope | null): { job: RenderJob; grant: RenderGrant } {
  const full: RenderJob = { ...job, id: uid('r'), createdAt: new Date().toISOString() };
  const grant = issueGrant(owner, full.id, scope);
  jobs.set(full.id, { job: full, grant, expires: Date.now() + TTL });
  return { job: full, grant };
}

export function dropJob(id: string) {
  const j = jobs.get(id);
  if (j) revokeGrant(j.grant.token);
  jobs.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of jobs) if (v.expires < now) dropJob(k);
}, 60_000).unref();

export function registerJobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/render/jobs/:id', async (req, reply) => {
    const p = req.principal;
    // Only the renderer holding THIS job's grant may read it.
    if (p?.kind !== 'render' || p.grant.jobId !== req.params.id) throw httpError(404, 'Render job not found or expired');
    const j = jobs.get(req.params.id);
    if (!j) throw httpError(404, 'Render job not found or expired');
    reply.header('Cache-Control', 'no-store');
    return j.job;
  });
}
