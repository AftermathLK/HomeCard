import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Secrets derived from APP_ENCRYPTION_KEY (and optionally SESSION_SECRET):
 *   - credentialKey: AES-256-GCM key for users' Immich API keys at rest
 *   - sessionKey:    HMAC-SHA256 key; the database stores HMAC(token), never the session token
 * Keys are derived with HKDF-SHA256 so the raw environment value is never used directly.
 */

export const MIN_SECRET_LENGTH = 32;

export class SecretConfigError extends Error {}

interface Keys {
  credentialKey: Buffer;
  sessionKey: Buffer;
  /** Short fingerprint used to detect a changed APP_ENCRYPTION_KEY (never the key itself). */
  fingerprint: string;
}

let keys: Keys | null = null;

const hkdf = (ikm: string | Buffer, info: string) => Buffer.from(crypto.hkdfSync('sha256', ikm, 'homecard.v1', info, 32));

export function missingKeyMessage(reason: string) {
  const example = crypto.randomBytes(48).toString('base64');
  return [
    '',
    '──────────────────────────────────────────────────────────────────────────────',
    ` HomeCard cannot start: ${reason}`,
    '──────────────────────────────────────────────────────────────────────────────',
    ' APP_ENCRYPTION_KEY encrypts every user\'s Immich API key at rest. Set it once and',
    ' keep it safe: if it changes later, users have to re-enter their Immich keys.',
    '',
    ' 1. Generate a key (any of these):',
    '      openssl rand -base64 48',
    '      node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"',
    '',
    ' 2. Add it to your .env file (docker compose) or the container variables (Unraid):',
    '      APP_ENCRYPTION_KEY=<the generated value>',
    '',
    ' Here is a freshly generated key you can use right now:',
    `      APP_ENCRYPTION_KEY=${example}`,
    '──────────────────────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}

/**
 * Validate and derive keys. In production a missing/short APP_ENCRYPTION_KEY is fatal.
 * In development (`npm run dev`) a random key is generated once and kept in the dev data folder.
 */
export function initKeys(opts: { encryptionKey: string; sessionSecret: string; isDev: boolean; devKeyFile: string }) {
  let enc = opts.encryptionKey.trim();
  if (!enc && opts.isDev) {
    try {
      enc = fs.readFileSync(opts.devKeyFile, 'utf8').trim();
    } catch {
      enc = crypto.randomBytes(48).toString('base64');
      fs.mkdirSync(path.dirname(opts.devKeyFile), { recursive: true });
      fs.writeFileSync(opts.devKeyFile, enc, { mode: 0o600 });
    }
    console.warn(`[homecard] APP_ENCRYPTION_KEY not set — using a development key from ${opts.devKeyFile}. Set APP_ENCRYPTION_KEY in production.`);
  }
  if (!enc) throw new SecretConfigError(missingKeyMessage('APP_ENCRYPTION_KEY is not set.'));
  if (enc.length < MIN_SECRET_LENGTH) throw new SecretConfigError(missingKeyMessage(`APP_ENCRYPTION_KEY is too short (${enc.length} characters; at least ${MIN_SECRET_LENGTH} required).`));
  if (/^(change-?me|changeme|secret|password|your[-_ ]?key.*)$/i.test(enc)) throw new SecretConfigError(missingKeyMessage('APP_ENCRYPTION_KEY still has its placeholder value.'));
  const session = opts.sessionSecret.trim();
  if (session && session.length < MIN_SECRET_LENGTH) {
    throw new SecretConfigError(`\nHomeCard cannot start: SESSION_SECRET is set but shorter than ${MIN_SECRET_LENGTH} characters. Remove it (a key is derived from APP_ENCRYPTION_KEY) or set a longer value.\n`);
  }
  keys = {
    credentialKey: hkdf(enc, 'immich-credentials'),
    sessionKey: session ? hkdf(session, 'sessions') : hkdf(enc, 'sessions'),
    fingerprint: crypto.createHmac('sha256', hkdf(enc, 'fingerprint')).update('homecard-key-check').digest('hex').slice(0, 16),
  };
  return keys;
}

function k(): Keys {
  if (!keys) throw new Error('Secrets not initialised');
  return keys;
}

export const keyFingerprint = () => k().fingerprint;

/** HMAC used to store session ids (a database leak does not reveal live session tokens). */
export function sessionDigest(token: string) {
  return crypto.createHmac('sha256', k().sessionKey).update(token).digest('hex');
}

export interface Sealed {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

/**
 * AES-256-GCM with a random 96-bit IV. `aad` binds the ciphertext to its owner (user id), so
 * copying one user's encrypted row onto another user's makes decryption fail.
 */
export function seal(plaintext: string, aad: string): Sealed {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k().credentialKey, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { iv, ciphertext, tag: c.getAuthTag() };
}

export function open(sealed: { iv: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array }, aad: string): string {
  const d = crypto.createDecipheriv('aes-256-gcm', k().credentialKey, Buffer.from(sealed.iv));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(Buffer.from(sealed.tag));
  return Buffer.concat([d.update(Buffer.from(sealed.ciphertext)), d.final()]).toString('utf8');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
