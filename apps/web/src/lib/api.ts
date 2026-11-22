/**
 * Tiny typed fetch wrapper + Server-Sent Events subscription.
 *
 * Every state-changing request carries the CSRF token (from the readable hc_csrf cookie the
 * server sets) in X-CSRF-Token. A 401 sends the browser to the sign-in page; a 403
 * "password_change_required" to the change-password screen.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data?: any,
  ) {
    super(message);
  }
}

export function csrfToken(): string {
  const jar = Object.fromEntries(
    document.cookie
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf('=');
        return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
      }),
  );
  return jar['__Host-hc_csrf'] ?? jar.hc_csrf ?? '';
}

let redirecting = false;
function handleAuthFailure(status: number, code: string | undefined) {
  if (redirecting || typeof location === 'undefined' || /^\/(login|setup|register)(\/|$)/.test(location.pathname)) return;
  if (status === 401 && code === 'auth_required') {
    redirecting = true;
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  } else if (status === 403 && code === 'password_change_required') {
    redirecting = true;
    location.assign('/login?change=1');
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, signal, headers, credentials: 'same-origin' };
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken();
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const obj = data && typeof data === 'object' ? (data as any) : null;
    const msg = (obj && 'error' in obj ? String(obj.error) : '') || `${res.status} ${res.statusText}`;
    handleAuthFailure(res.status, obj?.code);
    throw new ApiError(res.status, msg, obj?.code, obj);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, signal),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Multipart upload with progress (XHR, because fetch has no upload progress). */
export function upload<T>(url: string, files: File[] | FileList, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('file', f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-CSRF-Token', csrfToken());
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else {
        handleAuthFailure(xhr.status, (xhr.response as any)?.code);
        reject(new ApiError(xhr.status, (xhr.response as any)?.error ?? `Upload failed (${xhr.status})`, (xhr.response as any)?.code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(fd);
  });
}

type Handler = (type: string, data: any) => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;
const TYPES = ['fonts', 'styles', 'library', 'export', 'projects', 'project-thumb'];

function ensureSource() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  for (const t of TYPES) {
    source.addEventListener(t, (e) => {
      let data: unknown = null;
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch {
        /* ignore */
      }
      for (const h of handlers) h(t, data);
    });
  }
  source.onerror = () => {
    // EventSource reconnects by itself; nothing to do.
  };
}

export function onServerEvent(h: Handler): () => void {
  ensureSource();
  handlers.add(h);
  return () => handlers.delete(h);
}

export const enc = encodeURIComponent;
