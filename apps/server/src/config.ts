import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/server (works for both src/ via tsx and dist/ bundles). */
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..', '..');

const env = process.env;

function pickDataDir() {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR);
  if (fs.existsSync('/data')) return '/data';
  return path.join(repoRoot, '.devdata');
}

const dataDir = pickDataDir();
const dir = (name: string, envName: string) => path.resolve(env[envName] || path.join(dataDir, name));

const truthy = (v: string | undefined, dflt = false) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v.trim()));

/**
 * TRUST_PROXY: false (default) | true | <number of hops> | comma-separated IPs/CIDRs.
 * Only trust X-Forwarded-* from a reverse proxy you run — otherwise any LAN device could spoof
 * its IP (defeating login rate limits) or claim HTTPS.
 */
function parseTrustProxy(v: string | undefined): boolean | number | string[] {
  const s = (v ?? '').trim();
  if (!s || /^(0|false|no|off)$/i.test(s)) return false;
  if (/^(true|yes|on)$/i.test(s)) return true;
  if (/^\d+$/.test(s)) return Number(s);
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export const config = {
  version: '0.13.4',
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  dataDir,
  dirs: {
    /** Per user: /data/projects/<userId>/<projectId>/ */
    projects: dir('projects', 'PROJECTS_DIR'),
    /** Mounted photo library: shared/ (everyone) and users/<username>/ (private). Read-only is fine. */
    photos: dir('photos', 'PHOTOS_DIR'),
    /** Per user: /data/uploads/<userId>/ — photos uploaded in the browser. */
    uploads: dir('uploads', 'UPLOADS_DIR'),
    fonts: dir('fonts', 'FONTS_DIR'),
    styles: dir('styles', 'STYLES_DIR'),
    /** Per user: /data/exports/<userId>/<card>/<stamp>_<format>/ */
    exports: dir('exports', 'EXPORTS_DIR'),
    config: dir('config', 'CONFIG_DIR'),
    cache: dir('cache', 'CACHE_DIR'),
  },
  /**
   * Full-resolution Immich originals are written here for the length of one render and wiped
   * afterwards. In Docker this is the /tmp tmpfs (RAM), so private originals never touch disk.
   */
  ephemeralDir: path.resolve(env.EPHEMERAL_DIR || path.join(os.tmpdir(), 'homecard-ephemeral')),
  immich: {
    /** Server-level Immich URL (admins can also set it in the app). Users never choose the URL. */
    url: (env.IMMICH_URL ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, ''),
  },
  security: {
    /** Required. Encrypts users' Immich API keys at rest (AES-256-GCM, HKDF-derived key). */
    encryptionKey: env.APP_ENCRYPTION_KEY ?? '',
    /** Optional. HMAC key for session ids; derived from APP_ENCRYPTION_KEY when unset. */
    sessionSecret: env.SESSION_SECRET ?? '',
    allowRegistration: truthy(env.ALLOW_REGISTRATION, false),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    /** Force Secure cookies + HSTS (set when HomeCard is only reached over HTTPS). */
    https: truthy(env.HTTPS, false),
    /** Sessions expire after this many days without use. */
    sessionIdleDays: Math.max(1, Number(env.SESSION_IDLE_DAYS ?? 14)),
    /** …and after this many days regardless of use. */
    sessionMaxDays: Math.max(1, Number(env.SESSION_MAX_DAYS ?? 60)),
  },
  /**
   * Stock backgrounds. Keys can also be saved by an admin in Settings → Server (stored encrypted);
   * an environment variable, when set, wins and locks that setting. Use stock/keys.ts, not these.
   */
  stock: {
    pixabayKey: (env.PIXABAY_API_KEY ?? '').trim(),
    unsplashKey: (env.UNSPLASH_API_KEY ?? '').trim(),
    /** Keyless CC0 / public-domain search. Set OPENVERSE_ENABLED=false for a fully offline server. */
    openverse: truthy(env.OPENVERSE_ENABLED, true),
    openverseFromEnv: (env.OPENVERSE_ENABLED ?? '').trim() !== '',
  },
  /** Built web app (index.html + auth.html + render.html). */
  webDist: path.resolve(env.WEB_DIST || path.join(repoRoot, 'apps', 'web', 'dist')),
  assetsDir: path.resolve(env.ASSETS_DIR || path.join(serverRoot, 'assets')),
  starterDir: path.resolve(env.STARTER_DIR || path.join(repoRoot, 'data')),
  /** Origin the headless renderer loads /render.html from (dev: Vite dev server). */
  renderOrigin: (env.RENDER_ORIGIN ?? '').replace(/\/+$/, ''),
  chromiumPath: env.CHROMIUM_PATH || '',
  ghostscriptPath: env.GHOSTSCRIPT_PATH || '',
  cacheMaxBytes: Number(env.CACHE_MAX_MB ?? 4096) * 1024 * 1024,
  maxUploadMB: Number(env.MAX_UPLOAD_MB ?? 200),
  logLevel: env.LOG_LEVEL ?? 'info',
  isDev: env.NODE_ENV !== 'production',
  /** Variables from the early single-user builds that are no longer used (reported at startup). */
  legacy: {
    immichApiKey: !!(env.IMMICH_API_KEY ?? '').trim(),
    basicAuth: !!(env.AUTH_USERNAME || env.AUTH_PASSWORD),
  },
};

export const dbFile = () => path.join(config.dirs.config, 'homecard.db');

/**
 * Where headless Chromium loads /render.html from. Production: this server. `npm run dev`
 * without a web build: the Vite dev server (it serves render.html and proxies /api back here).
 */
export function renderOrigin() {
  if (config.renderOrigin) return config.renderOrigin;
  if (config.isDev && !fs.existsSync(path.join(config.webDist, 'render.html'))) return 'http://127.0.0.1:5173';
  return `http://127.0.0.1:${config.port}`;
}

export type Config = typeof config;
