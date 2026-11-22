/**
 * Admin recovery from the server's command line (for when nobody can sign in as an admin).
 *
 *   docker exec -it -u 99:100 homecard node apps/server/dist/cli.js <command>
 *   (development: npx tsx apps/server/src/cli.ts <command>)
 *
 * Commands:
 *   list-users                 accounts, roles and status
 *   reset-password <username>  new temporary password (must be changed at next sign-in),
 *                              clears that user's lockout, signs them out everywhere
 *   enable <username>          re-enable a disabled account
 *   unlock-all                 clear every sign-in lockout (all usernames and IP addresses)
 *
 * Every action is written to the security log.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { dbFile } from './config';
import { closeDb, openDb, run } from './db';
import { audit } from './security/audit';
import { hashPassword } from './security/passwords';
import { clearFailures, isLocked, userKey } from './security/ratelimit';
import { revokeUserSessions } from './security/sessions';
import { findUserByUsername, listUserRows, normalizeUsername, setPasswordHash, updateUserFields } from './security/users';

function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

function fail(msg: string): never {
  console.error(`homecard: ${msg}`);
  process.exit(1);
}

function userOrFail(name: string | undefined) {
  if (!name) fail('give a username, e.g. reset-password admin');
  const u = findUserByUsername(normalizeUsername(name));
  if (!u) fail(`no account named "${name}". Run "list-users".`);
  return u;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('Usage: cli.js list-users | reset-password <username> | enable <username> | unlock-all');
    return;
  }
  // Running as root would create root-owned SQLite journal files the server can't write.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    fail('don’t run this as root. Use: docker exec -it -u <PUID>:<PGID> homecard node apps/server/dist/cli.js …  (Unraid: -u 99:100)');
  }
  const file = dbFile();
  if (!fs.existsSync(file)) fail(`no database at ${file} — has HomeCard been set up yet?`);
  openDb(file);

  switch (cmd) {
    case 'list-users': {
      for (const u of listUserRows()) {
        const flags = [u.role, u.disabled ? 'DISABLED' : 'active', isLocked(userKey(u.username)) ? 'LOCKED' : '', u.must_change_password ? 'must change password' : ''].filter(Boolean).join(', ');
        console.log(`${u.username.padEnd(24)} ${u.display_name.padEnd(24)} ${flags}`);
      }
      break;
    }
    case 'reset-password': {
      const u = userOrFail(arg);
      const pw = tempPassword();
      setPasswordHash(u.id, await hashPassword(pw), true);
      clearFailures(userKey(u.username));
      const revoked = revokeUserSessions(u.id).length;
      audit({ event: 'user.password_reset', userId: u.id, username: u.username, detail: { target: u.username, via: 'cli', sessionsRevoked: revoked } });
      console.log(`Temporary password for ${u.username}: ${pw}`);
      console.log('They must choose a new password at the next sign-in.');
      if (u.disabled) console.log(`Note: this account is disabled. Run "enable ${u.username}" to allow sign-in.`);
      break;
    }
    case 'enable': {
      const u = userOrFail(arg);
      updateUserFields(u.id, { disabled: false });
      audit({ event: 'user.enabled', userId: u.id, username: u.username, detail: { target: u.username, via: 'cli' } });
      console.log(`${u.username} is enabled.`);
      break;
    }
    case 'unlock-all': {
      run('DELETE FROM login_attempts');
      audit({ event: 'user.unlocked', detail: { target: '*', via: 'cli' } });
      console.log('All sign-in lockouts cleared.');
      break;
    }
    default:
      fail(`unknown command "${cmd}". Try: list-users, reset-password, enable, unlock-all`);
  }
  closeDb();
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
