import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';

/**
 * Isolated, short-lived working directory for private full-resolution files (Immich originals,
 * HEIC decodes and the print-size JPEGs made from them). Created per export / per request and
 * destroyed in a `finally` block: every file is overwritten with zeros, flushed, then unlinked.
 *
 * In the Docker image the directory lives on the /tmp tmpfs (RAM), so the bytes never reach a
 * disk at all; the overwrite is defence in depth for setups where EPHEMERAL_DIR is on disk.
 */
export class EphemeralScope {
  private disposed = false;
  private constructor(readonly id: string, readonly dir: string) {}

  static async create(label: string): Promise<EphemeralScope> {
    const id = `${label.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'job'}-${crypto.randomBytes(8).toString('hex')}`;
    const dir = path.join(config.ephemeralDir, `hc-${id}`);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    return new EphemeralScope(id, dir);
  }

  /** Absolute path for a file inside this scope (name is hashed, so it can't escape). */
  file(name: string, ext: string) {
    if (this.disposed) throw new Error('Ephemeral scope already disposed');
    const h = crypto.createHash('sha1').update(name).digest('hex');
    return path.join(this.dir, `${h}.${ext.replace(/[^a-z0-9]/gi, '')}`);
  }

  get isDisposed() {
    return this.disposed;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await secureRemoveDir(this.dir);
  }
}

const CHUNK = 1024 * 1024;

/** Overwrite a file with zeros, fsync, unlink. */
export async function secureUnlink(file: string) {
  let fh: fsp.FileHandle | null = null;
  try {
    fh = await fsp.open(file, 'r+');
    const { size } = await fh.stat();
    const zeros = Buffer.alloc(Math.min(CHUNK, Math.max(1, size)));
    for (let pos = 0; pos < size; pos += zeros.length) await fh.write(zeros, 0, Math.min(zeros.length, size - pos), pos);
    await fh.sync();
  } catch {
    /* file already gone or not writable — still try to unlink */
  } finally {
    await fh?.close().catch(() => {});
  }
  await fsp.unlink(file).catch(() => {});
}

export async function secureRemoveDir(dir: string) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await secureRemoveDir(p);
    else await secureUnlink(p);
  }
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** Remove scopes left behind by a crash or restart. */
export async function wipeStaleEphemeral() {
  await fsp.mkdir(config.ephemeralDir, { recursive: true, mode: 0o700 });
  for (const e of await fsp.readdir(config.ephemeralDir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && e.name.startsWith('hc-')) await secureRemoveDir(path.join(config.ephemeralDir, e.name));
  }
}

/** Run fn with a fresh scope that is always wiped afterwards. */
export async function withEphemeral<T>(label: string, fn: (scope: EphemeralScope) => Promise<T>): Promise<T> {
  const scope = await EphemeralScope.create(label);
  try {
    return await fn(scope);
  } finally {
    await scope.dispose();
  }
}
