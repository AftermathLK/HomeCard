import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/*
 * Database-backed checks: login lockout and per-user isolation of drafts and exports.
 * DATA_DIR must point at a throwaway folder BEFORE the server modules (and their config) load,
 * so everything here is imported dynamically.
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homecard-test-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

let mods: {
  db: typeof import('../src/db');
  users: typeof import('../src/security/users');
  rl: typeof import('../src/security/ratelimit');
  store: typeof import('../src/projects/store');
  exporter: typeof import('../src/render/exporter');
  shared: typeof import('@homecard/shared');
  paths: typeof import('../src/storage/paths');
  sessions: typeof import('../src/security/sessions');
  keys: typeof import('../src/security/keys');
};

before(async () => {
  mods = {
    db: await import('../src/db'),
    users: await import('../src/security/users'),
    rl: await import('../src/security/ratelimit'),
    store: await import('../src/projects/store'),
    exporter: await import('../src/render/exporter'),
    shared: await import('@homecard/shared'),
    paths: await import('../src/storage/paths'),
    sessions: await import('../src/security/sessions'),
    keys: await import('../src/security/keys'),
  };
  mods.keys.initKeys({ encryptionKey: 'isolation-test-key-'.repeat(3), sessionSecret: '', isDev: false, devKeyFile: '' });
  mods.db.openDb(path.join(dataDir, 'config', 'homecard.db'));
});

after(() => {
  mods?.db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('five failed sign-ins lock the account, with progressive lockout', () => {
  const { lockedFor, recordFailure, clearFailures, LOGIN_POLICY } = mods.rl;
  const keys = ['user:rivera', 'ip:192.168.1.50'];
  const t0 = Date.UTC(2026, 10, 22, 12);
  for (let i = 0; i < LOGIN_POLICY.maxFailures - 1; i++) assert.equal(recordFailure(keys, t0 + i * 1000), 0);
  assert.equal(lockedFor(keys, t0 + 5000), 0, 'four failures: still allowed');
  const lock1 = recordFailure(keys, t0 + 5000);
  assert.equal(lock1, 15 * 60, 'fifth failure locks for 15 minutes');
  assert.ok(lockedFor(keys, t0 + 6000) > 0);
  assert.equal(lockedFor(keys, t0 + 5000 + 15 * 60_000 + 1), 0, 'unlocks after 15 minutes');
  // Second lockout within a day doubles.
  let t = t0 + 5000 + 15 * 60_000 + 10;
  let lock2 = 0;
  for (let i = 0; i < LOGIN_POLICY.maxFailures; i++) lock2 = recordFailure(keys, t + i);
  assert.equal(lock2, 30 * 60);
  clearFailures('user:rivera');
  assert.ok(lockedFor(['ip:192.168.1.50'], t + 100) > 0, 'the IP stays locked even after the username is cleared');
  t += 0;
});

test('sessions are stored as HMAC digests and die with the user', async () => {
  const { insertUser, deleteUserRow } = mods.users;
  const { createSession, lookupSession } = mods.sessions;
  const u = insertUser({ username: 'sessiontest', displayName: 'Session Test', passwordHash: 'x', role: 'user', mustChangePassword: false });
  const s = createSession(u.id, { ip: '192.168.1.9', userAgent: 'test' });
  assert.ok(lookupSession(s.token));
  const rows = mods.db.all<{ id_hash: string }>('SELECT id_hash FROM sessions');
  assert.ok(rows.every((r) => r.id_hash !== s.token), 'the raw token is never stored');
  assert.equal(lookupSession(s.token.slice(0, -1) + (s.token.endsWith('A') ? 'B' : 'A')), null);
  deleteUserRow(u.id);
  assert.equal(lookupSession(s.token), null);
});

test('drafts are invisible to other users (no IDOR)', async () => {
  const { insertUser } = mods.users;
  const { createProjectRecord, loadProject, listProjects, saveProject, deleteProject, listVersions, assertOwner } = mods.store;
  const a = insertUser({ username: 'mom', displayName: 'Mom', passwordHash: 'x', role: 'admin', mustChangePassword: false });
  const b = insertUser({ username: 'teen', displayName: 'Teen', passwordHash: 'x', role: 'user', mustChangePassword: false });
  const p = await createProjectRecord(a.id, { ...mods.shared.createProject({ occasionId: 'christmas' }), name: 'Rivera Christmas' });
  assert.equal((await loadProject(a.id, p.id)).name, 'Rivera Christmas');
  assert.equal((await listProjects(b.id)).length, 0);
  await assert.rejects(() => loadProject(b.id, p.id), /not found/i);
  await assert.rejects(() => saveProject(b.id, p.id, p), /not found/i);
  await assert.rejects(() => deleteProject(b.id, p.id), /not found/i);
  assert.throws(() => assertOwner(b.id, p.id), /not found/i);
  // Creating a project with someone else's id doesn't take it over.
  const hijack = await createProjectRecord(b.id, { ...p, name: 'mine now' });
  assert.notEqual(hijack.id, p.id);
  assert.equal((await loadProject(a.id, p.id)).name, 'Rivera Christmas');
  // Path tricks in ids are rejected outright.
  await assert.rejects(() => loadProject(a.id, '../teen'), /invalid/i);
  assert.ok((await listVersions(a.id, p.id)).length >= 1);
  // Files live under the owner's own folder.
  assert.ok(fs.existsSync(path.join(mods.paths.userProjectsDir(a.id), p.id, 'project.json')));
  assert.ok(!fs.existsSync(path.join(mods.paths.userProjectsDir(b.id), p.id)));
});

test('exports are invisible to other users', async () => {
  const { insertUser } = mods.users;
  const { exporter, paths, db } = mods;
  const a = insertUser({ username: 'dad', displayName: 'Dad', passwordHash: 'x', role: 'user', mustChangePassword: false });
  const b = insertUser({ username: 'grandma', displayName: 'Grandma', passwordHash: 'x', role: 'user', mustChangePassword: false });
  // A finished export on disk for user A (as if rendered earlier).
  const folder = 'rivera-christmas/2026-11-22_120000_pdf';
  const dir = path.join(paths.userExportsDir(a.id), folder);
  fs.mkdirSync(dir, { recursive: true });
  const rec = { id: 'x_testexport01', projectId: 'p_x', projectName: 'Rivera Christmas', createdAt: new Date().toISOString(), status: 'done', progress: 1, options: {}, files: [{ name: 'card.pdf', kind: 'pdf', bytes: 4, mime: 'application/pdf' }], warnings: [], folder };
  fs.writeFileSync(path.join(dir, '.homecard-export.json'), JSON.stringify(rec));
  fs.writeFileSync(path.join(dir, 'card.pdf'), '%PDF');
  await exporter.rescanExports();
  assert.equal(exporter.getExport(a.id, rec.id)?.id, rec.id);
  assert.equal(exporter.getExport(b.id, rec.id), null);
  assert.equal(exporter.listExports(b.id).length, 0);
  assert.equal(await exporter.deleteExport(b.id, rec.id), null);
  assert.ok(fs.existsSync(path.join(dir, 'card.pdf')), "another user can't delete it");
  assert.equal(db.one<{ owner_id: string }>('SELECT owner_id FROM exports WHERE id = ?', rec.id)?.owner_id, a.id);
});

test('stock API keys are stored encrypted and never handed back whole', async () => {
  const sk = await import('../src/stock/keys');
  const key = 'pixabay-test-key-1234567890-wxyz';
  assert.deepEqual(sk.stockKeyStatus('pixabay'), { source: 'none', last4: null, unreadable: false });
  sk.setStockKey('pixabay', key);
  assert.equal(sk.stockKey('pixabay'), key, 'the server can use it');
  const raw = mods.db.getSetting('stock_key_pixabay') ?? '';
  assert.ok(raw && !raw.includes(key) && !raw.includes('1234567890'), 'only ciphertext is stored');
  assert.deepEqual(sk.stockKeyStatus('pixabay'), { source: 'admin', last4: 'wxyz', unreadable: false });
  // Sealed to its provider: the Pixabay ciphertext doesn't open as the Unsplash key.
  mods.db.setSetting('stock_key_unsplash', raw);
  sk._resetStockKeyCache();
  assert.equal(sk.stockKey('unsplash'), '');
  assert.equal(sk.stockKeyStatus('unsplash').unreadable, true);
  sk.setStockKey('unsplash', '');
  assert.equal(sk.stockKeyStatus('unsplash').source, 'none');
  assert.throws(() => sk.normalizeStockKey('has a space in it'), /API key/);
  assert.throws(() => sk.normalizeStockKey('short'), /API key/);
  // Openverse defaults on and can be switched off.
  assert.equal(sk.openverseEnabled(), true);
  sk.setOpenverseEnabled(false);
  assert.equal(sk.openverseEnabled(), false);
  sk.setStockKey('pixabay', '');
  assert.equal(sk.stockKey('pixabay'), '');
});

test('holiday preferences are per person, validated, merged and removed with the account', async () => {
  const prefs = await import('../src/holidays/prefs');
  const { insertUser, deleteUserRow } = mods.users;
  const DEFAULTS = mods.shared.DEFAULT_HOLIDAY_PREFS;
  const a = insertUser({ username: 'planner', displayName: 'Planner', passwordHash: 'x', role: 'user', mustChangePassword: false });
  const b = insertUser({ username: 'cousin', displayName: 'Cousin', passwordHash: 'x', role: 'user', mustChangePassword: false });
  assert.deepEqual(prefs.getHolidayPrefs(a.id), DEFAULTS);
  const saved = prefs.saveHolidayPrefs(a.id, { hiddenOccasions: ['halloween', 'not-a-holiday'], lookaheadDays: 90, customTagMap: { christmas: ['card-picks'], bogus: ['x'] }, isAdmin: true });
  assert.deepEqual(saved, { showHomeBanner: true, lookaheadDays: 90, hiddenOccasions: ['halloween'], customTagMap: { christmas: ['card-picks'] } });
  assert.deepEqual(prefs.getHolidayPrefs(a.id), saved, 'read back from SQLite');
  assert.deepEqual(prefs.getHolidayPrefs(b.id), DEFAULTS, 'someone else’s settings are untouched');
  // A partial update keeps everything else.
  const merged = prefs.saveHolidayPrefs(a.id, { showHomeBanner: false });
  assert.equal(merged.showHomeBanner, false);
  assert.equal(merged.lookaheadDays, 90);
  assert.deepEqual(merged.hiddenOccasions, ['halloween']);
  // A damaged row can't break the home page.
  mods.db.run('UPDATE user_holiday_prefs SET prefs = ? WHERE user_id = ?', '{not json', a.id);
  assert.deepEqual(prefs.getHolidayPrefs(a.id), DEFAULTS);
  // Deleting the account deletes its preferences.
  prefs.saveHolidayPrefs(a.id, { lookaheadDays: 30 });
  deleteUserRow(a.id);
  assert.ok(!mods.db.one('SELECT user_id FROM user_holiday_prefs WHERE user_id = ?', a.id));
});
