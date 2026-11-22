import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { HttpError } from '../util/fsx';

/**
 * Outbound HTTP for stock providers, hardened against SSRF:
 *   - only http(s), only the hosts each caller allows (exact or sub-domain match);
 *   - every DNS answer must be a PUBLIC address (no loopback, RFC 1918, CGNAT, link-local,
 *     ULA, multicast or reserved ranges). The check runs inside the socket's own lookup, so the
 *     address that is validated is the address that is connected to (no DNS-rebinding window);
 *   - redirects are followed manually (max 3) and re-validated;
 *   - response size and time are capped.
 * The User-Agent names the app only — never the person using it.
 */

const UA = 'HomeCard/0.12 (self-hosted greeting card maker)';

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    if (s === '::' || s === '::1') return false;
    if (/^(fc|fd)/.test(s)) return false; // unique local
    if (/^fe[89ab]/.test(s)) return false; // link-local
    if (/^ff/.test(s)) return false; // multicast
    if (/^2001:db8:/.test(s) || /^2001:0?:/.test(s) || /^64:ff9b:/.test(s) || /^100::/.test(s)) return false;
    return /^[23]/.test(s); // global unicast only
  }
  return false;
}

export class BlockedRequestError extends Error {}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || !list.every((a) => isPublicAddress(a.address))) {
      return (callback as any)(new BlockedRequestError(`Refusing to connect to ${hostname}: it resolves to a private or reserved address.`));
    }
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
    (callback as any)(null, list[0].address, list[0].family);
  });
};

export interface SafeGetOptions {
  /** Allowed host names (a host also matches its sub-domains), or '*' for any public host. */
  hosts: string[] | '*';
  maxBytes: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  allowHttp?: boolean;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
}

function hostAllowed(host: string, hosts: SafeGetOptions['hosts']) {
  if (hosts === '*') return true;
  const h = host.toLowerCase().replace(/\.$/, '');
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

function checkUrl(raw: string, o: SafeGetOptions): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedRequestError('Invalid URL');
  }
  if (u.protocol !== 'https:' && !(o.allowHttp && u.protocol === 'http:')) throw new BlockedRequestError(`Blocked protocol ${u.protocol}`);
  if (u.username || u.password) throw new BlockedRequestError('Credentials in URL are not allowed');
  if (u.port && !['80', '443'].includes(u.port)) throw new BlockedRequestError('Non-standard ports are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedRequestError('Private addresses are not allowed');
    if (o.hosts !== '*') throw new BlockedRequestError('IP addresses are not allowed here');
  } else if (!hostAllowed(host, o.hosts)) {
    throw new BlockedRequestError(`Host ${host} is not allowed for this provider`);
  }
  return u;
}

function once(u: URL, o: SafeGetOptions): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup,
        agent: false,
        timeout: o.timeoutMs ?? 20_000,
        headers: { 'User-Agent': UA, Accept: '*/*', ...o.headers },
      },
      (res) => {
        const len = Number(res.headers['content-length'] ?? 0);
        if (len > o.maxBytes) {
          res.destroy();
          return reject(new Error(`Response too large (${Math.round(len / 1048576)} MB)`));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > o.maxBytes) {
            res.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), url: u.toString() }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

export async function safeGet(url: string, o: SafeGetOptions): Promise<SafeResponse> {
  let current = checkUrl(url, o);
  for (let hop = 0; hop <= 3; hop++) {
    const r = await once(current, o);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      current = checkUrl(new URL(String(r.headers.location), current).toString(), o);
      continue;
    }
    return r;
  }
  throw new Error('Too many redirects');
}

export async function safeGetJson<T>(url: string, o: Omit<SafeGetOptions, 'maxBytes'> & { maxBytes?: number }): Promise<T> {
  const r = await safeGet(url, { maxBytes: 4 * 1024 * 1024, ...o, headers: { Accept: 'application/json', ...o.headers } });
  // HttpError: these messages are safe to show and tell the user what to do.
  if (r.status === 401 || r.status === 403) throw new HttpError(502, 'The image service rejected the API key. An admin can check it in the server settings.');
  if (r.status === 429) throw new HttpError(429, 'The image service’s rate limit was reached. Try again in a minute.');
  if (r.status >= 500) throw new HttpError(502, `The image service is having trouble right now (HTTP ${r.status}). Try again in a moment.`);
  if (r.status >= 400) throw new HttpError(502, `The image service refused the request (HTTP ${r.status}).`);
  try {
    return JSON.parse(r.body.toString('utf8')) as T;
  } catch {
    throw new HttpError(502, 'The image service sent an unreadable answer. Try again in a moment.');
  }
}
