import fsp from 'node:fs/promises';
import path from 'node:path';
import { duplicateProject, migrateProject, uid, type CardProject, type ProjectSummary } from '@homecard/shared';
import { config } from '../config';
import { all, one, run } from '../db';
import { findUserById } from '../security/users';
import { USER_ID_RE, userProjectsDir } from '../storage/paths';
import { ensureDir, exists, httpError, readJson, writeFileAtomic } from '../util/fsx';

/**
 * Project persistence, per user:
 *   /data/projects/<userId>/<id>/project.json         current draft (autosaved)
 *   /data/projects/<userId>/<id>/versions/<ts>.json   restorable snapshots
 *   /data/projects/<userId>/<id>/thumb.jpg            low-DPI render of the front
 *   /data/projects/<userId>/.trash/<id>-<ts>/          soft-deleted projects (30 days)
 *
 * Ownership lives in SQLite (projects.owner_id). EVERY read, write and delete first checks that
 * row against the authenticated user — a project id belonging to someone else answers 404.
 */

const MAX_VERSIONS = 30;
const AUTO_SNAPSHOT_MS = 5 * 60_000;
const ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

export interface VersionInfo {
  id: string;
  createdAt: string;
  label: string;
  auto: boolean;
  bytes: number;
}

export type ProjectListItem = ProjectSummary & { hasThumb: boolean };

function checkId(id: string) {
  if (!ID_RE.test(String(id))) throw httpError(400, 'Invalid project id');
  return id;
}

/** Throws 404 unless `userId` owns project `id`. */
export function assertOwner(userId: string, id: string) {
  checkId(id);
  const row = one<{ owner_id: string }>('SELECT owner_id FROM projects WHERE id = ?', id);
  if (!row || row.owner_id !== userId) throw httpError(404, 'Project not found');
}

export function projectDir(userId: string, id: string) {
  return path.join(userProjectsDir(userId), checkId(id));
}
const projectFile = (userId: string, id: string) => path.join(projectDir(userId, id), 'project.json');
const versionsDir = (userId: string, id: string) => path.join(projectDir(userId, id), 'versions');
export const thumbFile = (userId: string, id: string) => path.join(projectDir(userId, id), 'thumb.jpg');

function summarize(p: CardProject): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    occasionId: p.occasionId,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    format: { sizeId: p.format.sizeId, widthIn: p.format.widthIn, heightIn: p.format.heightIn, fold: p.format.fold },
    sharedFrom: p.sharedFrom ? { displayName: p.sharedFrom.displayName, at: p.sharedFrom.at } : undefined,
  };
}

function upsertRow(userId: string, p: CardProject) {
  run(
    `INSERT INTO projects(id, owner_id, name, summary, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, summary = excluded.summary, updated_at = excluded.updated_at
     WHERE projects.owner_id = excluded.owner_id`,
    p.id,
    userId,
    p.name ?? '',
    JSON.stringify(summarize(p)),
    Date.parse(p.createdAt) || Date.now(),
    Date.parse(p.updatedAt) || Date.now(),
  );
}

export async function listProjects(userId: string): Promise<ProjectListItem[]> {
  const rows = all<{ id: string; summary: string }>('SELECT id, summary FROM projects WHERE owner_id = ? ORDER BY updated_at DESC', userId);
  const out: ProjectListItem[] = [];
  for (const r of rows) {
    if (!(await exists(projectFile(userId, r.id)))) continue;
    try {
      out.push({ ...(JSON.parse(r.summary) as ProjectSummary), hasThumb: await exists(thumbFile(userId, r.id)) });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

export async function loadProject(userId: string, id: string): Promise<CardProject> {
  assertOwner(userId, id);
  const raw = await readJson<any>(projectFile(userId, id), null);
  if (!raw) throw httpError(404, 'Project not found');
  return migrateProject({ ...raw, id });
}

function validate(p: CardProject) {
  if (!p || typeof p !== 'object') throw httpError(400, 'Project body required');
  if (!Array.isArray(p.surfaces) || !p.format || !p.theme) throw httpError(400, 'Malformed project');
}

async function latestVersionTime(userId: string, id: string): Promise<number> {
  const files = await fsp.readdir(versionsDir(userId, id)).catch(() => [] as string[]);
  let best = 0;
  for (const f of files) {
    const t = Number(f.split('_')[0]);
    if (t > best) best = t;
  }
  return best;
}

export async function saveProject(userId: string, id: string, body: CardProject, opts: { create?: boolean } = {}): Promise<CardProject> {
  validate(body);
  checkId(id);
  if (opts.create) {
    if (one('SELECT 1 AS x FROM projects WHERE id = ?', id)) throw httpError(409, 'Project already exists');
  } else {
    assertOwner(userId, id);
  }
  await ensureDir(projectDir(userId, id));
  const now = new Date().toISOString();
  // The server decides id and ownership-related fields; the body can't move a project elsewhere.
  const project = migrateProject({ ...body, id, updatedAt: now, createdAt: body.createdAt || now });
  await writeFileAtomic(projectFile(userId, id), JSON.stringify(project));
  upsertRow(userId, project);
  if (Date.now() - (await latestVersionTime(userId, id)) > AUTO_SNAPSHOT_MS) await snapshot(userId, id, project, 'Autosave', true);
  return project;
}

export async function createProjectRecord(userId: string, body: CardProject): Promise<CardProject> {
  const wanted = body.id && ID_RE.test(body.id) && !one('SELECT 1 AS x FROM projects WHERE id = ?', body.id) ? body.id : uid('p');
  const p = await saveProject(userId, wanted, { ...body, id: wanted }, { create: true });
  await snapshot(userId, wanted, p, 'Created', true);
  return p;
}

export async function snapshot(userId: string, id: string, project: CardProject, label: string, auto: boolean): Promise<VersionInfo> {
  const dir = versionsDir(userId, id);
  await ensureDir(dir);
  const t = Date.now();
  const vid = `${t}_${auto ? 'a' : 'm'}`;
  const json = JSON.stringify({ label, auto, project });
  await writeFileAtomic(path.join(dir, `${vid}.json`), json);
  const list = await listVersions(userId, id);
  const autos = list.filter((v) => v.auto);
  const manual = list.filter((v) => !v.auto);
  const keepAuto = Math.max(5, MAX_VERSIONS - manual.length);
  for (const v of autos.slice(keepAuto)) await fsp.unlink(path.join(dir, `${v.id}.json`)).catch(() => {});
  for (const v of manual.slice(MAX_VERSIONS)) await fsp.unlink(path.join(dir, `${v.id}.json`)).catch(() => {});
  return { id: vid, createdAt: new Date(t).toISOString(), label, auto, bytes: json.length };
}

export async function listVersions(userId: string, id: string): Promise<VersionInfo[]> {
  const dir = versionsDir(userId, id);
  const files = (await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => /^\d+_[am]\.json$/.test(f));
  const out: VersionInfo[] = [];
  for (const f of files) {
    const st = await fsp.stat(path.join(dir, f)).catch(() => null);
    if (!st) continue;
    const [t, kind] = f.replace('.json', '').split('_');
    let label = kind === 'a' ? 'Autosave' : 'Snapshot';
    try {
      const fh = await fsp.open(path.join(dir, f), 'r');
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(300), 0, 300, 0);
      await fh.close();
      const m = /"label":"((?:[^"\\]|\\.)*)"/.exec(buffer.subarray(0, bytesRead).toString('utf8'));
      if (m) label = JSON.parse(`"${m[1]}"`);
    } catch {
      /* ignore */
    }
    out.push({ id: f.replace('.json', ''), createdAt: new Date(Number(t)).toISOString(), label, auto: kind === 'a', bytes: st.size });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadVersion(userId: string, id: string, vid: string): Promise<CardProject> {
  assertOwner(userId, id);
  if (!/^\d+_[am]$/.test(vid)) throw httpError(400, 'Invalid version id');
  const raw = await readJson<any>(path.join(versionsDir(userId, id), `${vid}.json`), null);
  if (!raw?.project) throw httpError(404, 'Version not found');
  return migrateProject({ ...raw.project, id });
}

export async function restoreVersion(userId: string, id: string, vid: string): Promise<CardProject> {
  const current = await loadProject(userId, id);
  await snapshot(userId, id, current, 'Before restore', false);
  const v = await loadVersion(userId, id, vid);
  return saveProject(userId, id, { ...v, name: v.name || current.name, sharedFrom: current.sharedFrom });
}

export async function deleteProject(userId: string, id: string) {
  assertOwner(userId, id);
  const dir = projectDir(userId, id);
  if (await exists(dir)) {
    const trash = path.join(userProjectsDir(userId), '.trash');
    await ensureDir(trash);
    await fsp.rename(dir, path.join(trash, `${id}-${Date.now()}`));
  }
  run('DELETE FROM projects WHERE id = ? AND owner_id = ?', id, userId);
}

export async function duplicate(userId: string, id: string, name?: string): Promise<CardProject> {
  const src = await loadProject(userId, id);
  const copy = duplicateProject(src, name);
  const p = await createProjectRecord(userId, copy);
  if (await exists(thumbFile(userId, id))) await fsp.copyFile(thumbFile(userId, id), thumbFile(userId, p.id)).catch(() => {});
  return p;
}

/** Purge per-user trash entries older than 30 days. */
export async function purgeTrash() {
  const cutoff = Date.now() - 30 * 86400_000;
  for (const u of await fsp.readdir(config.dirs.projects).catch(() => [] as string[])) {
    if (!USER_ID_RE.test(u)) continue;
    const trash = path.join(config.dirs.projects, u, '.trash');
    for (const e of await fsp.readdir(trash).catch(() => [] as string[])) {
      const t = Number(e.split('-').pop());
      if (t && t < cutoff) await fsp.rm(path.join(trash, e), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Make the database agree with the folders: projects found in /data/projects/<userId>/ (e.g.
 * restored from a backup) get an ownership row for that user; rows whose files are gone are dropped.
 */
export async function reconcileProjects(log: (m: string) => void) {
  let added = 0;
  for (const u of await fsp.readdir(config.dirs.projects, { withFileTypes: true }).catch(() => [])) {
    if (!u.isDirectory() || !USER_ID_RE.test(u.name) || !findUserById(u.name)) continue;
    for (const e of await fsp.readdir(path.join(config.dirs.projects, u.name), { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('.') || !ID_RE.test(e.name)) continue;
      const raw = await readJson<any>(path.join(config.dirs.projects, u.name, e.name, 'project.json'), null);
      if (!raw) continue;
      const row = one<{ owner_id: string }>('SELECT owner_id FROM projects WHERE id = ?', e.name);
      if (row) {
        if (row.owner_id !== u.name) log(`Project ${e.name} exists for two users; keeping the original owner.`);
        continue;
      }
      try {
        upsertRow(u.name, migrateProject({ ...raw, id: e.name }));
        added++;
      } catch {
        /* unreadable */
      }
    }
  }
  for (const r of all<{ id: string; owner_id: string }>('SELECT id, owner_id FROM projects')) {
    if (!(await exists(path.join(userProjectsDir(r.owner_id), r.id, 'project.json')))) run('DELETE FROM projects WHERE id = ?', r.id);
  }
  if (added) log(`Registered ${added} project(s) found on disk.`);
}
