import crypto from 'node:crypto';

/**
 * Argon2id password hashing (Node's built-in crypto.argon2, RFC 9106 parameters:
 * 64 MiB memory, 3 passes, 1 lane). Hashes are stored in the standard PHC string format
 *   $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
 * so they stay verifiable by any Argon2 library.
 */

const PARAMS = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 } as const;
const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
const unb64 = (s: string) => Buffer.from(s, 'base64');

function argon2id(message: string, nonce: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.argon2('argon2id', { message: Buffer.from(message, 'utf8'), nonce, ...p }, (err, out) => (err ? reject(err) : resolve(Buffer.from(out))));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await argon2id(password, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const m = PHC.exec(phc);
  if (!m) return false;
  const [, mem, t, p, salt, hash] = m;
  const expected = unb64(hash);
  const actual = await argon2id(password, unb64(salt), { memory: Number(mem), passes: Number(t), parallelism: Number(p), tagLength: expected.length });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Hash used for unknown usernames so a failed login takes the same time either way. */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummy);
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwertyuiop', 'qwerty1234', '1234567890', '0123456789', '1111111111',
  'iloveyou12', 'letmein123', 'welcome123', 'homecard', 'homecard123', 'christmas', 'christmas1', 'merrychristmas', 'abcdefghij', 'administrator',
]);

/** Returns a human message when the password is not acceptable, otherwise null. */
export function passwordProblem(password: string, username?: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Try a short phrase of a few words.';
  if (/^(.)\1+$/.test(password)) return 'Don’t repeat a single character.';
  if (username && username.length >= 3 && lower.includes(username.toLowerCase())) return 'The password must not contain the username.';
  return null;
}
