import { checkImmichRequest, IMMICH_REQUIRED_SCOPES } from '@homecard/shared';
import { HttpError, httpError } from '../util/fsx';

/**
 * ReadOnlyImmichClient — the ONLY way HomeCard talks to Immich.
 *
 * Layer 1 of the read-only guarantee:
 *  - There is no generic "request" method. Callers can only GET an allowlisted read endpoint or
 *    POST to one of Immich's read-only search endpoints (see IMMICH_GET/POST_ALLOWLIST).
 *  - Every request is checked by checkImmichRequest() *before* fetch is called. DELETE, PUT and
 *    PATCH — or any non-allowlisted path — throw ImmichWriteBlockedError and nothing is sent.
 *  - The API key lives in a private class field and is only ever placed in the x-api-key header.
 *  - Redirects are not followed (the key would otherwise travel to wherever Immich points).
 */

export class ImmichWriteBlockedError extends Error {
  readonly fatal = true;
  readonly statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = 'ImmichWriteBlockedError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ReadOnlyImmichOptions {
  fetch?: FetchLike;
  /** Called with the reason whenever a request is blocked (audit log). */
  onBlocked?: (reason: string) => void;
}

const SCOPE_HINT = `HomeCard needs: ${IMMICH_REQUIRED_SCOPES.map((s) => s.id).join(', ')}.`;

export class ReadOnlyImmichClient {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #onBlocked?: (reason: string) => void;

  constructor(baseUrl: string, apiKey: string, opts: ReadOnlyImmichOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.#apiKey = apiKey;
    this.#fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.#onBlocked = opts.onBlocked;
  }

  /** The single choke point. Validates method + path, then (and only then) calls fetch. */
  async #send(method: 'GET' | 'POST', path: string, body: unknown, accept: string, timeoutMs: number): Promise<Response> {
    const check = checkImmichRequest(method, path);
    if (!check.ok) {
      this.#onBlocked?.(check.reason);
      throw new ImmichWriteBlockedError(check.reason);
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      const headers: Record<string, string> = { 'x-api-key': this.#apiKey, Accept: accept };
      if (check.method === 'POST') headers['Content-Type'] = 'application/json';
      res = await this.#fetch(`${this.baseUrl}${check.pathname}${check.search}`, {
        method: check.method,
        headers,
        body: check.method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        redirect: 'manual',
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e instanceof ImmichWriteBlockedError) throw e;
      throw httpError(502, `Cannot reach Immich at ${this.baseUrl}: ${e?.cause?.code ?? e?.message ?? e}`);
    } finally {
      clearTimeout(t);
    }
    if (res.status >= 300 && res.status < 400) {
      throw httpError(502, `Immich answered with a redirect (${res.status}${res.headers.get('location') ? ` to ${res.headers.get('location')}` : ''}). Ask your admin to set the Immich URL to the final address.`);
    }
    return res;
  }

  /** GET an allowlisted endpoint and parse JSON. */
  async get<T>(path: string, timeoutMs = 30_000): Promise<T> {
    const res = await this.#send('GET', path, undefined, 'application/json', timeoutMs);
    return this.#json<T>(res, path);
  }

  /** GET an allowlisted binary endpoint (thumbnails, originals). Caller checks res.ok. */
  async getBinary(path: string, timeoutMs = 60_000): Promise<Response> {
    return this.#send('GET', path, undefined, 'image/*,application/octet-stream;q=0.9,*/*;q=0.5', timeoutMs);
  }

  /** POST to one of Immich's read-only search endpoints. */
  async search<T>(kind: 'metadata' | 'smart' | 'random', body: Record<string, unknown>): Promise<T> {
    const path = `/api/search/${kind}`;
    const res = await this.#send('POST', path, body, 'application/json', 60_000);
    return this.#json<T>(res, path);
  }

  /** Raw status probe used by key verification (no throwing on 4xx). */
  async probe(path: string): Promise<{ status: number; body: any }> {
    const res = await this.#send('GET', path, undefined, 'application/json', 20_000);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  async #json<T>(res: Response, path: string): Promise<T> {
    const route = path.split('?')[0];
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new HttpError(401, 'Immich rejected your API key (401). Create a new read-only key in Immich → Account Settings → API Keys and save it under Profile → Immich connection.');
      if (res.status === 403) throw new HttpError(403, `Your Immich API key lacks permission for ${route} (403). ${SCOPE_HINT}`);
      throw new HttpError(res.status === 404 ? 404 : 502, `Immich ${route} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
