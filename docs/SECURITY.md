# HomeCard — Security model and verification

HomeCard is a multi-user app meant to be safe on a home network:

* every page and API needs a signed-in account;
* each person's cards, uploads, exports and Immich library are private to them;
* HomeCard can **never** change or delete anything in Immich, enforced twice;
* exported files carry no EXIF/GPS or other metadata.

This document has three parts: [where things are kept](#1-storage-and-request-flow),
[how each protection works](#2-how-it-works), and [how to check it yourself](#3-security-verification).

---

## 1. Storage and request flow

### 1.1 Database (`/data/config/homecard.db`, SQLite via Node's built-in `node:sqlite`)

One SQLite file, created automatically on first start (WAL mode, foreign keys on):

| Table | Holds |
|---|---|
| `users` | id, username (unique, case-insensitive), display name, **Argon2id** hash, role `admin`/`user`, `must_change_password`, `disabled`, per-user prefs (default printer) |
| `sessions` | **HMAC-SHA256 digest** of the session token (the token itself is never stored), user, CSRF token, created/last-seen/expiry, IP, user agent. Deleted with the user. |
| `immich_credentials` | per user: the Immich API key encrypted with **AES-256-GCM** (IV, ciphertext, auth tag; the user id is the AAD), last 4 characters, the permissions Immich reported, whether they were verified or confirmed by hand |
| `projects` | ownership: project id → owner user id (+ name/summary for the list) |
| `exports` | ownership: export id → owner, project, folder |
| `audit_log` | security log (kept 1 year) |
| `login_attempts` | failure counters and lockouts per IP and per username |
| `settings` | server-level settings: Immich URL and the Openverse switch (when not set by environment variables), and admin-saved Pixabay / Unsplash keys, **AES-256-GCM** encrypted (the provider name is the AAD), with their last 4 characters |
| `stock_items`, `stock_searches` | 24-hour cache of stock-image search results |

### 1.2 Files on disk

| Path | Holds |
|---|---|
| `/data/projects/<userId>/<project>/` | a person's cards (draft, versions, small assets) |
| `/data/exports/<userId>/<card>/<stamp>_<fmt>/` | a person's print files |
| `/data/uploads/<userId>/` | photos a person uploaded in the browser |
| `/data/photos/shared/**` | folder photos everyone can use (the mount can be read-only) |
| `/data/photos/users/<username>/**` | folder photos only that user sees; anything else in `/data/photos` is not shown |
| `/data/styles/stock-cache/` | downloaded stock backgrounds (shared) |
| `/data/fonts`, `/data/styles` | fonts and Style Packs, shared by everyone |

### 1.3 First start

1. The server refuses to start until `APP_ENCRYPTION_KEY` is set (32+ characters), with a message
   explaining how to generate one.
2. Every page redirects to **/setup** until the first admin account exists; then `/setup` closes
   for good. Further accounts are created by the admin (invite-only), unless
   `ALLOW_REGISTRATION=true`.
3. (Only for data left by the early single-user builds: an old `settings.json` is folded into the
   database and securely deleted, its shared Immich API key is discarded, the old shared media
   cache is cleared, and the first admin adopts the old projects, exports and uploads.)

### 1.4 Auth middleware

A single `onRequest` hook (`apps/server/src/auth/guard.ts`) runs before every route, static file
and the SPA fallback. A request gets through only as:

* **a signed-in user** — valid, unexpired session cookie; the account isn't disabled. Users who
  must change their password can reach only the password-change endpoints.
* **the print renderer** — headless Chromium carries a per-job grant token (`x-homecard-render`)
  that only works while that export runs, for that user's data, for GET requests.
* **a public path** — exactly `/login`, `/setup` (until the first account exists), `/register`
  (only with `ALLOW_REGISTRATION=true`), `/health` (`{"status":"ok"}` only), `/api/auth/state`,
  the login/setup/register POSTs, the login page's own JS/CSS (read from the Vite manifest) and
  two UI font files.

Everything else gets 401 (API) or a redirect to `/login?next=…` (pages). Every state-changing
request also needs the CSRF token.

### 1.5 `ReadOnlyImmichClient`

`apps/server/src/immich/readonly.ts` is the **only** module that talks to Immich (a test scans
the code base to keep it that way). The client is built per request from the authenticated user's
id; its public methods are `get`, `getBinary`, `probe` and `search` — there is no way to send a
body with any other method. Every request passes `checkImmichRequest()` (shared, unit-tested)
before `fetch` is called. Redirects are refused so a request can't be bounced elsewhere.

### 1.6 Stock backgrounds

```
Browser ──/api/stock/search──▶ HomeCard ──HTTPS (allowlisted host, public IPs only)──▶ Pixabay / Unsplash / Openverse
        ◀── results (thumbnails via /api/stock/thumb, cached 24 h) ──
Browser ──/api/stock/select──▶ HomeCard downloads the full image once → normalised sRGB JPEG, metadata stripped
                                → /data/styles/stock-cache/<provider>-<id>.jpg (+ .json credit)
Card    ── background: "stock:<file>" (served by /api/stock/file/<file>, or /api/backgrounds/soft for Soften)
```

API keys stay on the server. An admin can save them in Settings → Server: HomeCard checks the key
with the provider first, stores it encrypted, and afterwards shows only its last 4 characters; the
audit log records who saved or removed which provider's key, never the key. Thumbnails are
proxied, except Unsplash's, which Unsplash's terms require to be loaded from
`images.unsplash.com` (the only external host the page's CSP allows, and only while an Unsplash
key is set). Selecting an Unsplash photo triggers its download-tracking
endpoint, as Unsplash requires. The Pattern & Paper Studio generates SVG in the browser and the
renderer — no network at all.

---

## 2. How it works

### Accounts and sessions

* Passwords: **Argon2id** (Node's built-in `crypto.argon2`; 64 MiB, 3 passes), minimum 10
  characters, common passwords and passwords containing the username are refused.
* Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-hc_session` when
  Secure). Only its HMAC is stored. Expires after 14 days idle or 60 days total
  (`SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS`). A new session id is issued at every sign-in and
  password change; changing a password, being disabled or a password reset signs out every
  other session and closes their live-update streams.
* `Secure` cookies + HSTS: automatic when the request is HTTPS — directly, or via a trusted proxy's
  `X-Forwarded-Proto: https` (`TRUST_PROXY`) — and always with `HTTPS=true`.
* Brute force: 5 failures within 15 minutes per IP **and** per username lock that key for 15
  minutes, doubling on each further lockout up to 24 hours. Unknown usernames cost the same time
  as real ones. Admins can unlock a user.
* Recovery when no admin can sign in: on the server,
  `docker exec -it -u <PUID>:<PGID> homecard node apps/server/dist/cli.js reset-password <username>`
  prints a temporary password (also `list-users`, `enable <username>`, `unlock-all`). Shell access to
  the container is required, and every use is written to the security log.
* CSRF: every non-GET request needs `X-CSRF-Token` equal to the session's token (double-submit
  against the `hc_csrf` cookie before sign-in). Requests whose `Origin` (or `Referer`) is another
  site are rejected too, and logged as `security.csrf_rejected`.
* Headers on every response: strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors
  'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  same-origin`, COOP/CORP same-origin, a restrictive `Permissions-Policy`. API responses are
  `Cache-Control: no-store`.

### Per-user isolation (no IDOR)

* Every handler gets the user id from the session (`userOf(req)`), never from the request.
* Project, export and upload paths are built from that id and checked with
  `path.resolve` + root-prefix + `realpath` checks; ownership is also checked in the database.
  Asking for someone else's card or export gives 404, exactly like a card that doesn't exist.
* Photo refs are checked per user: `upload:` only from your uploads, `library:users/<you>/…`
  only for you, `immich:` only through your own Immich key.
* The live-update stream (SSE) only delivers your own events.
* **Share copy with another user** copies the card JSON and flattens every placed photo into the
  recipient's uploads folder at print resolution. The recipient never gets a reference to your
  Immich library or folders.

### Immich: read-only, twice

* **Layer 1 (code):** `checkImmichRequest()` throws a fatal error for any `DELETE`, `PUT` or
  `PATCH`, and allows only `GET` on `/api/users/me`, `/api/api-keys/me`, `/api/albums`,
  `/api/albums/:id`, `/api/assets/:id`, `/api/assets/:id/thumbnail`, `/api/assets/:id/original`,
  `/api/people`, `/api/people/:id`, `/api/people/:id/thumbnail`, `/api/faces`, `/api/memories`,
  `/api/server/ping` and `POST` on `/api/search/metadata`, `/api/search/smart`,
  `/api/search/random`. Path traversal, encoded slashes, extra segments and malformed ids are
  rejected. Blocked attempts are logged as `immich.blocked_request`.
* **Layer 2 (the key):** saving or testing a key calls `GET /api/api-keys/me`. Keys with `all`,
  any `*.create`/`*.update`/`*.delete`/`*.write`, `admin.*`, `asset.upload` (or any non-read
  permission) are refused with an explanation. If the Immich server doesn't report permissions,
  the user must confirm the scopes by hand (a warning banner stays visible) — Layer 1 still applies.
  Re-checking a saved key that has since gained write permissions deletes it.
* The key is encrypted at rest and never sent back to the browser — only its last 4 characters.

### Files

* **Metadata scrubbing:** every exported PNG, JPEG and PDF is cleaned after rendering — JPEG
  EXIF/XMP/IPTC/comments and other APPn segments (ICC and JFIF density kept), PNG
  `eXIf`/`tEXt`/`zTXt`/`iTXt`/`tIME` chunks, PDF Info dictionary (title only) and XMP streams.
  Each file is then re-read and the Export Verification screen shows "Metadata: none".
* **Ephemeral originals:** full-resolution Immich originals fetched for an export go into a
  private per-render temp folder (`/tmp/homecard-ephemeral`, in RAM in the compose setup) and are
  overwritten and deleted in a `finally` block when the render ends — also on failure. Leftovers
  from a crash are wiped at start-up.
* **Thumbnails and previews:** the small Immich derivatives the editor shows are re-encoded before
  they're cached in that user's private cache folder, so no EXIF/GPS from Immich is kept on disk or
  sent to the browser.
* **SVG sanitising:** uploaded and style-pack SVGs are rebuilt from an allowlist — no `<script>`,
  event handlers, `<foreignObject>`, external `href`/`url()` (only `#id` and embedded
  `data:image/*`), no CSS `@import`/`expression()`/escaped tricks — before they reach the browser
  or Chromium, and are served with their own `default-src 'none'` CSP.
* **Browser cache:** API answers are `no-store`. Photos, thumbnails and exports the browser may
  keep are `private` and `Vary: Cookie`, so after signing out (or as another HomeCard user in the
  same browser) a cached copy isn't reused without the server checking the session again.
* **Paths:** every read under `/data/photos`, `/data/fonts`, `/data/styles`, uploads, projects
  and exports goes through `path.resolve` + root-prefix + `realpath` checks (no `..`, no symlinks
  out of the root).
* **Outbound requests** (stock images): HTTPS only, host allowlist per provider, DNS answers must
  be public IPs (no LAN/loopback/metadata addresses — no SSRF into your network), redirects
  re-checked, size and time limits. Users can never enter a URL the server fetches; the Immich
  URL is admin-only.

### Container

* Runs as `PUID:PGID` (default 99:100), never root; refuses `PUID=0`.
* `cap_drop: ALL`; only `CHOWN`, `DAC_OVERRIDE`, `SETUID`, `SETGID` are added, for the
  entrypoint to fix folder ownership before it drops to the app user with no capabilities.
* `no-new-privileges`, read-only root filesystem, `/tmp` on tmpfs, `pids_limit`.
* Photos mounted read-only. `UMASK=027`: files aren't world-readable.
* `HEALTHCHECK` uses `/health`, which reveals nothing.

---

## 3. Security verification

Run these after deploying. `HC=http://<server>:8787`.

### 3.1 Nothing is reachable without signing in

```sh
curl -s  $HC/health                              # {"status":"ok"}
curl -si $HC/api/projects | head -1              # HTTP/1.1 401
curl -si $HC/api/immich/albums | head -1         # 401
curl -si "$HC/api/media/thumb?ref=library:shared/x.jpg" | head -1   # 401
curl -si $HC/ | grep -i '^location'              # Location: /login
curl -si $HC/setup | grep -i '^location'         # after setup: Location: /login
```

### 3.2 Headers and cookies

```sh
curl -si $HC/login | grep -iE 'content-security-policy|x-frame-options|x-content-type-options'
```

Sign in in a browser, open DevTools → Application → Cookies: `hc_session` (or `__Host-hc_session`
over HTTPS) is `HttpOnly` and `SameSite=Lax`.

### 3.3 Brute-force lockout

Run this from a computer you don't need for the next 15 minutes: the lock applies to the IP
address as well as the username.

```sh
T=0123456789abcdef0123456789abcdef   # any 20+ character value, sent as cookie and header
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $T" -b "hc_csrf=$T" \
  -d '{"username":"nobody-here","password":"wrong-password"}' $HC/api/auth/login; done
# 401 401 401 401 429 429
```

Settings → Security log shows `Sign-in failed` ×5 and `Locked out after failed sign-ins`. For a
real account, Settings → Users shows "Locked" with an unlock button.

### 3.4 CSRF

```sh
curl -si -X POST -b "hc_session=<copied from the browser>" $HC/api/auth/logout | head -1   # 403 (no X-CSRF-Token)
curl -si -X POST -H "Origin: http://evil.example" -b "hc_session=<…>" $HC/api/auth/logout | head -1   # 403
```

### 3.5 Isolation between two users

1. As the admin, create user **sam** (Settings → Users). Sign in as sam in a private window and
   choose a password.
2. As the admin, make a card and export it. Copy its id from the address bar (`#/card/<id>`).
3. As sam, open `$HC/#/card/<id>` — "card not found". `GET /api/projects/<id>` and
   `GET /api/exports?projectId=<id>` from sam's browser return 404 / an empty list.
4. Put a photo in `photos/users/<admin>/`: sam's photo picker doesn't show it; the admin's does
   (under "My photos"). Photos in `photos/shared/` show for both.
5. As the admin, **Share copy with another user** → sam. Sam sees the card with a "From …" badge
   and the photos, but sam's Immich tab still shows only sam's own library.

### 3.6 Immich read-only

1. In Immich, create a key with **all** permissions. In HomeCard, Profile → Immich connection →
   paste → **Check key**: refused, listing the dangerous permissions. **Save** is disabled; forcing
   it via the API returns 422 `dangerous_scopes`.
2. Create a key with only the checklist permissions → accepted, "Immich confirmed this key is
   read-only".
3. `npm test` runs the Layer 1 tests: every `DELETE`/`PUT`/`PATCH` and every non-allowlisted path
   is blocked **before** `fetch` is called.

### 3.7 No metadata in exports

Export a PNG, JPEG and PDF of a card with an Immich photo that has GPS data, then:

```sh
exiftool -a -G1 card.jpg card.png card.pdf | grep -iE 'gps|serial|make|model|software|date|xmp'
# (no output)
```

The Export Verification screen shows "Metadata: none" per file.

### 3.8 No lingering originals

During and after an export: `docker exec homecard ls -la /tmp/homecard-ephemeral` — a job folder
appears only while rendering and is empty/removed afterwards.

### 3.9 Container

```sh
docker exec homecard ps -o user,pid,comm        # node runs as 99 (or your PUID), not root
docker inspect homecard --format '{{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.SecurityOpt}}'
docker inspect homecard --format '{{.State.Health.Status}}'   # healthy
```
