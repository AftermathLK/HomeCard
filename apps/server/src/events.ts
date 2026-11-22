import type { FastifyInstance, FastifyReply } from 'fastify';
import { userOf, sessionOf } from './auth/context';

/**
 * Server-Sent Events hub for live reload.
 *  - Shared changes (fonts, styles, library) go to every signed-in browser.
 *  - Private changes (exports, projects, thumbnails) go only to their owner's browsers.
 * Streams are closed when their session is revoked (sign-out, password reset, account disabled).
 */
interface Client {
  reply: FastifyReply;
  userId: string;
  sessionHash: string | null;
  ping: NodeJS.Timeout;
}

const clients = new Set<Client>();

function send(c: Client, payload: string) {
  try {
    c.reply.raw.write(payload);
  } catch {
    drop(c);
  }
}

function drop(c: Client) {
  clearInterval(c.ping);
  clients.delete(c);
  try {
    c.reply.raw.end();
  } catch {
    /* already closed */
  }
}

/** Broadcast a shared event (no private data) to every connected user. */
export function emit(type: 'fonts' | 'styles' | 'library', data: unknown = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) send(c, payload);
}

/** Send a private event to one user's connections only. */
export function emitTo(userId: string, type: 'export' | 'projects' | 'project-thumb', data: unknown = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.userId === userId) send(c, payload);
}

export function closeStreams(match: { userId?: string; sessionHashes?: string[] }) {
  for (const c of [...clients]) {
    if ((match.userId && c.userId === match.userId) || (c.sessionHash && match.sessionHashes?.includes(c.sessionHash))) drop(c);
  }
}

export function registerEvents(app: FastifyInstance) {
  app.get('/api/events', (req, reply) => {
    const user = userOf(req);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const c: Client = { reply, userId: user.userId, sessionHash: sessionOf(req)?.id_hash ?? null, ping: setInterval(() => send(c, `: ping\n\n`), 25_000) };
    clients.add(c);
    req.raw.on('close', () => drop(c));
    reply.hijack();
  });
}
