import fsp from 'node:fs/promises';
import path from 'node:path';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController } from 'fastify';
import type { HealthInfo } from '@homecard/shared';
import { registerAdminRoutes } from './auth/admin';
import { migrateLegacyConfig } from './auth/adopt';
import { userOf } from './auth/context';
import { loadPublicAssets, registerAuthGuard } from './auth/guard';
import { registerAuthRoutes } from './auth/routes';
import { config, dbFile } from './config';
import { closeDb, openDb } from './db';
import { registerEvents } from './events';
import { registerFontRoutes, rescanFonts } from './fonts/fonts';
import { immichServerUrl, isLinked } from './immich/credentials';
import { registerImmichRoutes } from './immich/routes';
import { registerLibraryRoutes } from './library/routes';
import { registerMediaRoutes } from './media/routes';
import { registerProjectRoutes } from './projects/routes';
import { purgeTrash, reconcileProjects } from './projects/store';
import { closeBrowser, rendererStatus } from './render/browser';
import { loadExportIndex } from './render/exporter';
import { ghostscript, iccProfiles } from './render/ghostscript';
import { registerJobRoutes } from './render/jobs';
import { registerExportRoutes } from './render/routes';
import { pruneAudit } from './security/audit';
import { registerSecurityHeaders } from './security/headers';
import { initKeys, keyFingerprint, SecretConfigError } from './security/keys';
import { purgeOldAttempts } from './security/ratelimit';
import { purgeExpiredSessions } from './security/sessions';
import { countUsers } from './security/users';
import { providerInfo } from './stock/providers';
import { purgeStockCache, registerStockRoutes } from './stock/routes';
import { purgeDataTrash } from './storage/paths';
import { registerStyleRoutes, rescanStyles, seedStarterKit } from './styles/styles';
import { trimCache } from './util/cache';
import { wipeStaleEphemeral } from './util/ephemeral';
import { ensureDir, exists, HttpError, toPosix } from './util/fsx';
import { startWatchers } from './watch';

/* ---------- Secrets first: refuse to start without a proper encryption key ---------- */
try {
  initKeys({
    encryptionKey: config.security.encryptionKey,
    sessionSecret: config.security.sessionSecret,
    isDev: config.isDev,
    devKeyFile: path.join(config.dirs.config, 'dev-encryption.key'),
  });
} catch (err) {
  if (err instanceof SecretConfigError) {
    console.error(`\n${err.message}\n`);
    process.exit(78); // EX_CONFIG
  }
  throw err;
}

for (const d of Object.values(config.dirs)) await ensureDir(d);
openDb(dbFile());

const app = Fastify({
  logger: { level: config.logLevel },
  bodyLimit: 25 * 1024 * 1024,
  // Only trust X-Forwarded-* when told to (TRUST_PROXY): otherwise any LAN device could spoof its IP
  // (defeating the login rate limit) or claim HTTPS.
  trustProxy: config.security.trustProxy as boolean | string | string[],
  logController: new LogController({ disableRequestLogging: (req) => !config.isDev || req.url.startsWith('/api/events') }),
});

await app.register(multipart, { limits: { fileSize: config.maxUploadMB * 1024 * 1024, files: 500, fields: 20, parts: 520 } });

app.setErrorHandler((err: any, req, reply) => {
  // Routes may set a cache header before the work that failed; never let a browser cache an error.
  reply.header('Cache-Control', 'no-store');
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, ...(err as any).extra });
  const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) req.log.error(err);
  // Internal error details stay in the server log.
  return reply.code(status).send({ error: status >= 500 && !config.isDev ? 'Something went wrong on the server.' : (err.message ?? 'Internal error') });
});

/* ---------- Auth wall + security headers (run before every route, static files included) ---------- */
registerAuthGuard(app);
registerSecurityHeaders(app);

/* ---------- API ---------- */
registerAuthRoutes(app);
registerAdminRoutes(app);
registerEvents(app);
registerImmichRoutes(app);
registerMediaRoutes(app);
registerLibraryRoutes(app);
registerFontRoutes(app);
registerStyleRoutes(app);
registerStockRoutes(app);
registerProjectRoutes(app);
registerJobRoutes(app);
registerExportRoutes(app);

/** Detailed status for the signed-in app (the public /health says only {"status":"ok"}). */
app.get<{ Querystring: { quick?: string } }>('/api/health', async (req): Promise<HealthInfo> => {
  const me = userOf(req);
  const quick = !!req.query.quick;
  const [gs, profiles, renderer] = await Promise.all([
    ghostscript(),
    iccProfiles(),
    quick ? Promise.resolve({ available: true, detail: 'not checked (quick)' }) : rendererStatus(),
  ]);
  return {
    ok: true,
    version: config.version,
    renderer,
    ghostscript: { available: !!gs, version: gs?.version },
    heic: true,
    immich: { serverConfigured: !!immichServerUrl().url, linked: isLinked(me.userId) },
    dirs: me.role === 'admin' ? Object.fromEntries(Object.entries(config.dirs).map(([k, v]) => [k, toPosix(v)])) : undefined,
    iccProfiles: profiles.map(({ id, name, colorSpace }) => ({ id, name, colorSpace })),
    stock: providerInfo(),
  };
});

/* ---------- Web app (built SPA + auth.html + render.html) ---------- */
if (await exists(path.join(config.webDist, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    prefix: '/',
    index: false,
    serveDotFiles: false,
    allowedPath: (pathName) => !pathName.startsWith('/.vite'),
    setHeaders(res, file) {
      if (/[\\/]assets[\\/]/.test(file)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      else res.header('Cache-Control', 'no-cache');
    },
  });
  const indexHtml = await fsp.readFile(path.join(config.webDist, 'index.html'));
  // The guard has already required a signed-in user for everything that reaches here.
  const sendApp = (reply: any) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(indexHtml);
  app.get('/', async (_req, reply) => sendApp(reply));
  app.get('/index.html', async (_req, reply) => reply.redirect('/'));
  app.setNotFoundHandler((req, reply) => {
    const p = req.url.split('?')[0];
    if (req.method === 'GET' && !p.startsWith('/api/') && !p.startsWith('/fonts/') && !p.startsWith('/assets/') && !path.extname(p)) return sendApp(reply);
    return reply.code(404).send({ error: 'Not found' });
  });
} else {
  app.log.warn(`Web build not found at ${config.webDist} — API only (run "npm run build" or use the Vite dev server).`);
}

/* ---------- Startup ---------- */
const log = (m: string) => app.log.info(m);
await wipeStaleEphemeral();
await migrateLegacyConfig((m) => app.log.warn(m));
await seedStarterKit(log);
await Promise.all([rescanFonts(), rescanStyles()]);
await reconcileProjects(log);
await loadExportIndex();
loadPublicAssets(log);

const housekeeping = () => {
  try {
    purgeExpiredSessions();
    purgeOldAttempts();
    pruneAudit();
    purgeStockCache();
  } catch (err: any) {
    app.log.error(err, 'housekeeping failed');
  }
  purgeTrash().catch(() => {});
  purgeDataTrash().catch(() => {});
  trimCache().catch(() => {});
};
housekeeping();
setInterval(housekeeping, 30 * 60_000).unref();
startWatchers(log);

const shutdown = async () => {
  await closeBrowser().catch(() => {});
  await app.close().catch(() => {});
  closeDb();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
log(`HomeCard ${config.version} listening on http://${config.host}:${config.port} (data: ${toPosix(config.dataDir)}, key ${keyFingerprint()})`);
if (countUsers() === 0) log('No accounts yet: open HomeCard in a browser to create the first admin (/setup).');
if (!immichServerUrl().url) log('Immich is not configured: set IMMICH_URL or add it in Settings → Server (admins).');
