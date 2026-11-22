import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * SQLite (Node's built-in node:sqlite, no native modules) at /data/config/homecard.db.
 *
 * Holds identities and ownership — never card content or photos:
 *   users, sessions, immich_credentials (AES-256-GCM ciphertext), projects/exports (owner rows
 *   checked on every request), audit_log, login_attempts, settings, stock_items.
 */

let db: DatabaseSync | null = null;

const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE users (
    id                    TEXT PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name          TEXT NOT NULL,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    disabled              INTEGER NOT NULL DEFAULT 0,
    prefs                 TEXT NOT NULL DEFAULT '{}',
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    password_changed_at   INTEGER NOT NULL,
    last_login_at         INTEGER
  );

  CREATE TABLE sessions (
    id_hash       TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token    TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    ip            TEXT,
    user_agent    TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE immich_credentials (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    key_iv           BLOB NOT NULL,
    key_ciphertext   BLOB NOT NULL,
    key_tag          BLOB NOT NULL,
    key_last4        TEXT NOT NULL,
    permissions      TEXT,
    scopes_verified  INTEGER NOT NULL DEFAULT 0,
    manual_ack       INTEGER NOT NULL DEFAULT 0,
    immich_user      TEXT,
    verified_at      INTEGER,
    updated_at       INTEGER NOT NULL
  );

  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX projects_owner ON projects(owner_id, updated_at DESC);

  CREATE TABLE exports (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  TEXT NOT NULL,
    folder      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX exports_owner ON exports(owner_id, project_id);

  CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    event     TEXT NOT NULL,
    outcome   TEXT NOT NULL DEFAULT 'ok',
    user_id   TEXT,
    username  TEXT,
    ip        TEXT,
    detail    TEXT
  );
  CREATE INDEX audit_at ON audit_log(at DESC);

  CREATE TABLE login_attempts (
    key             TEXT PRIMARY KEY,
    failures        INTEGER NOT NULL DEFAULT 0,
    window_start    INTEGER NOT NULL,
    last_failure    INTEGER NOT NULL,
    locked_until    INTEGER NOT NULL DEFAULT 0,
    lockouts        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE TABLE stock_items (
    key         TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE stock_searches (
    key         TEXT PRIMARY KEY,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  `,
];

function migrate(d: DatabaseSync) {
  const current = Number((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(MIGRATIONS[v]);
      d.exec(`PRAGMA user_version = ${v + 1}`);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Open (or create) the database. `:memory:` is used by the tests. */
export function openDb(file: string): DatabaseSync {
  if (db) db.close();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec('PRAGMA synchronous = NORMAL');
  d.exec('PRAGMA foreign_keys = ON');
  d.exec('PRAGMA busy_timeout = 5000');
  d.exec('PRAGMA secure_delete = ON');
  migrate(d);
  db = d;
  if (file !== ':memory:') {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort (Windows / network shares) */
    }
  }
  return d;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not opened');
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

type Row = Record<string, any>;

export function one<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return getDb().prepare(sql).run(...params);
}

/** Run `fn` inside a write transaction (BEGIN IMMEDIATE … COMMIT / ROLLBACK). */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(key: string): string | undefined {
  return one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) run('DELETE FROM settings WHERE key = ?', key);
  else run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
