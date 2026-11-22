import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Atomic write: write to a temp file in the same directory, then rename. */
export async function writeFileAtomic(file: string, data: string | Buffer | Uint8Array) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, data: unknown) {
  await writeFileAtomic(file, JSON.stringify(data, null, 2));
}

/**
 * Resolve a user-supplied relative path inside `root`. Throws on traversal attempts.
 * Accepts forward or back slashes; returns an absolute path.
 */
export function safeJoin(root: string, rel: string): string {
  const cleaned = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.split('/').some((seg) => seg === '..')) throw httpError(400, 'Invalid path');
  const abs = path.resolve(root, cleaned);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw httpError(400, 'Invalid path');
  return abs;
}

/**
 * Canonical, symlink-proof version of safeJoin for reading existing files: resolves the real
 * path of both the root and the target (following symlinks) and requires the target to still be
 * inside the root. A symlink in /data/photos pointing at /etc/passwd is refused.
 */
export async function safeRealPath(root: string, rel: string): Promise<string> {
  const abs = safeJoin(root, rel);
  let realRoot: string;
  let realAbs: string;
  try {
    realRoot = await fsp.realpath(root);
    realAbs = await fsp.realpath(abs);
  } catch {
    throw httpError(404, 'File not found');
  }
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) throw httpError(403, 'Path escapes its folder');
  const st = await fsp.stat(realAbs).catch(() => null);
  if (!st) throw httpError(404, 'File not found');
  return realAbs;
}

/** True when `abs` (already resolved) is inside `root`. */
export function isInside(root: string, abs: string) {
  const r = path.resolve(root);
  const a = path.resolve(abs);
  return a === r || a.startsWith(r + path.sep);
}

export function toPosix(p: string) {
  return p.split(path.sep).join('/');
}

export function sha1(input: string | Buffer) {
  return createHash('sha1').update(input).digest('hex');
}

export function slugify(s: string, max = 48) {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’']/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, max) || 'card'
  );
}

export function sanitizeFileName(name: string) {
  const base = path.basename(String(name ?? 'file')).replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '');
  return base.slice(0, 120) || 'file';
}

/** Find a non-colliding file name in dir. */
export async function uniquePath(dir: string, fileName: string) {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(dir, fileName);
  let i = 1;
  while (await exists(candidate)) candidate = path.join(dir, `${stem}-${i++}${ext}`);
  return candidate;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
export const httpError = (code: number, msg: string) => new HttpError(code, msg);

export async function dirSize(dir: string): Promise<{ bytes: number; files: Array<{ path: string; size: number; atimeMs: number }> }> {
  const files: Array<{ path: string; size: number; atimeMs: number }> = [];
  let bytes = 0;
  async function walk(d: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const st = await fsp.stat(p).catch(() => null);
        if (st) {
          bytes += st.size;
          files.push({ path: p, size: st.size, atimeMs: Math.max(st.atimeMs, st.mtimeMs) });
        }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}
