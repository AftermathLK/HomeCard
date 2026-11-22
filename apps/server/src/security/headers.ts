import type { FastifyInstance } from 'fastify';
import { isSecureRequest } from '../auth/cookies';
import { stockKey } from '../stock/keys';

/**
 * Security headers on every response (helmet-equivalent, no extra dependency):
 * a strict same-origin CSP, no framing, no MIME sniffing, no cross-origin embedding.
 * Responses that set their own CSP (sanitised style-pack SVGs) keep it.
 */
export function buildCsp() {
  // Unsplash's API terms require showing its images from images.unsplash.com (hotlinking);
  // only the thumbnails in the Backgrounds picker do that, and only while a key is configured
  // (admins can add or remove it at runtime, so this is worked out per response).
  const img = ["'self'", 'data:', 'blob:', ...(stockKey('unsplash') ? ['https://images.unsplash.com'] : [])];
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' permits WebAssembly only (face detection); JS eval stays blocked.
    "script-src 'self' 'wasm-unsafe-eval'",
    // React and the card renderer use inline style attributes for print geometry.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

export function registerSecurityHeaders(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.getHeader('content-security-policy')) reply.header('Content-Security-Policy', buildCsp());
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Origin-Agent-Cluster', '?1');
    reply.header('X-DNS-Prefetch-Control', 'off');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()');
    if (isSecureRequest(req)) reply.header('Strict-Transport-Security', 'max-age=15552000');
    // Private data must never land in shared caches; API JSON is never cached at all.
    const cc = reply.getHeader('cache-control');
    if (!cc) reply.header('Cache-Control', req.url.startsWith('/api/') ? 'no-store' : 'private, no-cache');
    else if (typeof cc === 'string' && cc.startsWith('public') && !/[\\/]assets[\\/]|^\/assets\//.test(req.url) && !req.url.startsWith('/fonts/bundled/')) {
      reply.header('Cache-Control', cc.replace(/^public/, 'private'));
    }
    // Photos, thumbnails and exports may sit in the browser cache for a while. Key that copy to
    // the session cookie, so after signing out (or as another HomeCard user in the same browser)
    // the cached copy isn't shown without asking the server again.
    const finalCc = String(reply.getHeader('cache-control') ?? '');
    if (/^private\b/.test(finalCc) && /max-age=[1-9]/.test(finalCc)) {
      const vary = String(reply.getHeader('vary') ?? '');
      if (!/\bcookie\b/i.test(vary)) reply.header('Vary', vary ? `${vary}, Cookie` : 'Cookie');
    }
    return payload;
  });
}
