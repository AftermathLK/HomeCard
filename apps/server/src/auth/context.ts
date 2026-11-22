import type { FastifyRequest } from 'fastify';
import type { UserRole } from '@homecard/shared';
import type { RenderGrant } from '../render/grants';
import type { SessionRow } from '../security/sessions';
import type { UserRow } from '../security/users';
import type { EphemeralScope } from '../util/ephemeral';
import { httpError } from '../util/fsx';

export type Principal = { kind: 'user'; user: UserRow; session: SessionRow } | { kind: 'render'; grant: RenderGrant };

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

/**
 * Who a request acts for. Always derived from the server-side session (or render grant) —
 * never from anything the client sends in headers, query or body.
 */
export interface Actor {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** True for the headless print renderer acting for `userId`. */
  render: boolean;
  /** Render jobs: private scratch space for Immich originals. */
  scope: EphemeralScope | null;
  jobId: string | null;
}

export function actorOf(req: FastifyRequest): Actor {
  const p = req.principal;
  if (!p) throw httpError(401, 'Sign in required');
  if (p.kind === 'render') {
    const g = p.grant;
    return { userId: g.userId, username: g.username, displayName: g.displayName, role: g.role, render: true, scope: g.scope, jobId: g.jobId };
  }
  const u = p.user;
  return { userId: u.id, username: u.username, displayName: u.display_name, role: u.role, render: false, scope: null, jobId: null };
}

/** A signed-in person (not the renderer). */
export function userOf(req: FastifyRequest): Actor {
  const a = actorOf(req);
  if (a.render) throw httpError(403, 'Not available to the renderer');
  return a;
}

export function adminOf(req: FastifyRequest): Actor {
  const a = userOf(req);
  if (a.role !== 'admin') throw httpError(403, 'Only an admin can do that');
  return a;
}

export function sessionOf(req: FastifyRequest): SessionRow | null {
  return req.principal?.kind === 'user' ? req.principal.session : null;
}

export const clientIp = (req: FastifyRequest) => req.ip ?? req.socket?.remoteAddress ?? 'unknown';
