# HomeCard — Architecture

HomeCard is a self-hosted, local-first studio for designing holiday and occasion cards
and exporting files that print vendors accept as-is. It runs as one Docker container: a
Node.js backend plus a React editor. It needs no cloud services, sends no telemetry and
needs no API keys apart from your own (optional) Immich key.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Editor UI | React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand/Immer | Fast HMR, typed document model, easy undo/redo with structural sharing |
| Card renderer | **DOM + inline SVG** laid out in physical units (`in`, `pt`) | The same code renders the editor and the 300 DPI export (see §3) |
| Backend | Node.js 22 + Fastify 5 (TypeScript, bundled with esbuild) | One language across the stack. The pure layout, crop and color code is shared |
| Imaging | Sharp/libvips (+ `heic-convert` for HEIC/HEIF) | Fast Lanczos resampling, EXIF orientation, ICC handling, density metadata |
| Print engine | Headless Chromium via Playwright | Same layout engine as the editor. Gives exact device-pixel screenshots and vector PDF text |
| PDF post-processing | `pdf-lib` (TrimBox/BleedBox, OutputIntent, metadata) + Ghostscript (CMYK) | Prepress-grade boxes and real CMYK conversion |
| Face detection | Immich face boxes (preferred) → in-browser `@vladmandic/face-api` (SSD MobileNet, model files served locally) → saliency fallback | Works offline and never uploads photos anywhere |
| Persistence | JSON documents on disk (atomic writes + rolling version snapshots) | Easy to read, back up, diff and sync |

---

## 2. Repository layout

```
HomeCard/
├─ Dockerfile                    multi-stage: build web+server → slim runtime w/ Chromium + Ghostscript
├─ docker-compose.yml            volumes: /data/{config,projects,uploads,exports,fonts,styles,cache} + photos (:ro);
│                                read-only rootfs, /tmp tmpfs, cap_drop ALL, no-new-privileges
├─ docker/entrypoint.sh          creates /data layout, chowns writable dirs to PUID/PGID, drops root (setpriv)
├─ docker/unraid.sh              no-Compose deploy: copy source, build, run hardened container, health wait
├─ .env.example
├─ package.json                  npm workspaces
├─ scripts/
│  ├─ collect-fonts.mjs          copies bundled OFL fonts (Fontsource) → apps/server/assets/fonts
│  ├─ collect-vendor.mjs         copies face-detection model files → apps/web/public/vendor
│  └─ generate-textures.mjs      procedurally renders the starter-kit paper/linen/bokeh textures
├─ packages/shared/src/          ← pure TypeScript, imported by BOTH web and server
│  ├─ types.ts                   card document model (CardProject, Surface, CardElement…)
│  ├─ formats.ts                 card sizes, fold types, print-vendor presets, geometry helpers
│  ├─ units.ts                   inch/pt/px/DPI math
│  ├─ color.ts                   sRGB/OKLCH/WCAG contrast utilities
│  ├─ harmony.ts                 dominant-color extraction + contrast-safe theme generation
│  ├─ adjustments.ts             photo-polish pixel pipeline, filter presets, auto-enhance
│  ├─ crop.ts                    cover math + face-aware smart crop + saliency focus
│  ├─ fonts.ts                   bundled font manifest + designer pairings
│  ├─ holidays.ts                occasion catalog (greetings, palettes, ornaments)
│  ├─ ornaments.ts               procedurally generated, recolorable SVG ornaments
│  ├─ templates/                 24+ responsive templates + apply/switch/migrate logic
│  ├─ guardian.ts                Print Guardian rules (DPI, background DPI, safe zone, contrast, placeholders)
│  ├─ immich.ts                  ⭐ read-only Immich allowlist (Layer 1) + API-key scope analysis (Layer 2)
│  ├─ backdrops.ts               Pattern & Paper Studio: seeded procedural vector backdrops
│  ├─ api.ts                     DTOs shared by server and web (accounts, Immich connection, stock…)
│  ├─ stylepack.ts               Style Pack schema + validation
│  └─ project.ts                 new-project factory, tokens ({{year}}, {{family}})
├─ apps/server/src/
│  ├─ index.ts                   Fastify bootstrap: keys → SQLite → auth guard → headers → routes, housekeeping
│  ├─ cli.ts                     admin recovery: list-users, reset-password, enable, unlock-all
│  ├─ config.ts / db.ts          env; SQLite (node:sqlite) schema + migrations
│  ├─ auth/                      ⭐ guard (every request), login/setup/register, admin users + audit, cookies,
│  │                             adoption of data from the early single-user builds
│  ├─ security/                  Argon2id passwords, sessions (HMAC-stored), AES-256-GCM keys, lockouts,
│  │                             audit log, security headers/CSP
│  ├─ storage/paths.ts           per-user folders + path canonicalisation (resolve + prefix + realpath)
│  ├─ immich/                    ReadOnlyImmichClient, per-user encrypted credentials, proxy routes
│  ├─ stock/                     Pixabay / Unsplash / Openverse providers, SSRF-safe fetch, Soften
│  ├─ media/                     ref resolver, HEIC/RAW decode, thumbnails/previews, print sources
│  ├─ library/                   /data/photos scanner + browser uploads
│  ├─ fonts/                     /data/fonts scanner (fontkit), @font-face CSS generator, uploads
│  ├─ styles/                    /data/styles Style Pack loader, SVG sanitizer, zip/json import
│  ├─ projects/                  JSON project store, versions, duplicate, thumbnails
│  ├─ render/                    Chromium pool, render jobs + per-job grants, PNG/JPEG/PDF/share exporters,
│  │                             pdf-lib post-processing + font read-back, Ghostscript CMYK/proofs,
│  │                             privacy.ts (EXIF/XMP/PDF metadata scrubbing), ephemeral originals
│  ├─ watch.ts                   chokidar watchers on /data/fonts, /data/styles, /data/photos
│  └─ events.ts                  Server-Sent Events (live reload of fonts/styles/photos/projects/exports)
├─ apps/web/
│  ├─ index.html                 editor app
│  ├─ render.html                headless print page (loaded only by the server's Chromium)
│  └─ src/
│     ├─ main.tsx / App.tsx      editor app entry: session check, home ↔ editor, global modals, toasts
│     ├─ auth-main.tsx, auth/    sign-in / first-run setup / register / forced password change (auth.html)
│     ├─ render-main.tsx         print page entry: loads a render job, waits for fonts/images, reports
│     ├─ render/CardSurface.tsx  ⭐ the one card renderer (shared by editor, thumbnails & print)
│     ├─ home/                   project gallery + "New card" wizard (occasion → details/format)
│     ├─ setup/                  occasion grid, greeting style, size/fold/vendor fields
│     ├─ editor/
│     │  ├─ EditorScreen.tsx     top bar (undo, versions, Guided/Studio, Preview), sidebars, pages bar
│     │  ├─ Canvas.tsx           selection, move/resize/rotate, snap guides, crop mode, keyboard
│     │  ├─ Inspector.tsx        properties of the selected element
│     │  ├─ GuardianHost/Panel   DOM measurement (ink bounds, overflow, contrast) → shared rules → UI
│     │  ├─ MockupView.tsx       desk / envelope / studio scenes, 3D flip, open folded card
│     │  └─ panels/              Templates, Photos, Text, Style (palette/fonts/finish), Backgrounds
│     │                          (stock + Pattern studio), Polish, Decor, Layers
│     ├─ picker/                 photo picker: Immich (albums/people/years/favorites/search),
│     │                          photo folder, upload
│     ├─ export/                 export dialog + Export Verification (pixel viewer, read-back)
│     ├─ settings/               Profile, Immich connection (guided read-only key), fonts, style packs,
│     │                          printing, system; admin: Users, Security log, Server
│     ├─ store/                  Zustand stores: editor (document + undo) and ui (selection, modals…)
│     └─ lib/                    API client, assets/SSE, actions, image worker, faces, guardian input
├─ data/                         starter kit seeded into /data on first run
│  ├─ styles/                    sample Style Packs (JSON + SVG + textures)
│  └─ fonts/README.md
└─ docs/                         ARCHITECTURE, SECURITY, STYLE_PACKS, VERIFICATION
```

---

## 3. How the editor matches the print file pixel for pixel

The key decision: **there is one renderer, and it runs in a browser in both places.**

```
                 ┌──────────────── CardProject JSON (inches, pt, theme tokens) ────────────────┐
                 │                                                                              │
     Editor (your browser)                                              Print engine (server)
 <CardSurface mode="editor">                                        headless Chromium → /render.html
  • laid out at 96 CSS px/in                                         <CardSurface mode="print">
  • CSS transform: scale(zoom)                                         • same component, same CSS
  • preview-size photos (≤1600px)                                      • deviceScaleFactor = DPI / 96
  • polish applied by Web Worker                                       • full-res photos, Lanczos-sized,
    using shared/adjustments.ts                                          polish baked by server using the
                                                                         SAME shared/adjustments.ts
                                                                     → PNG/JPEG screenshot (exact px)
                                                                     → page.pdf() (vector text/SVG)
```

1. **Physical units everywhere.** Every element is stored in inches and font sizes in
   points. The DOM uses real CSS `in`/`pt` units, and Chromium defines `1in = 96px`.
   Layout, line breaking and auto-fit all run in that unscaled space. The editor zooms with a
   CSS transform, which never re-flows text. Line breaks in the editor therefore match line
   breaks in the export.
2. **Exact DPI.** The server renders with `deviceScaleFactor = 300/96 = 3.125`, so a
   5.25″ × 7.25″ page (5×7 + 0.125″ bleed) becomes exactly `1575 × 2175` device pixels. Sharp
   then checks the size, embeds an sRGB ICC profile and writes 300 DPI density metadata.
3. **Same fonts.** Bundled and custom fonts are served from one generated
   `/api/fonts/fonts.css` stylesheet. Both browsers load it. Before capture, the print page
   waits for `document.fonts.load()` on every family, weight and style the card uses.
   The export fails loudly if a font is missing.
4. **Image swapping without drift.** Crops are stored as resolution-independent values
   `{cx, cy, zoom}` (the image point at the frame center, plus zoom relative to "cover").
   The editor shows a ≤1600 px preview. The print page requests
   `/api/media/print?ref=…&w=<exact pixels needed>`. The server fetches the **original**
   (from Immich, disk or an upload), decodes HEIC/TIFF/WebP, applies EXIF orientation,
   converts to sRGB and resamples with Lanczos to the exact pixel width the frame needs at
   the export DPI. It never upscales.
5. **Photo polish is pixel math, not CSS filters.** Auto-Enhance, filters and sliders run
   through one pure function in `shared/adjustments.ts`. The browser runs it in a Web
   Worker on the preview. The server runs it on the full-resolution pixels. The function
   works per pixel and does not depend on resolution, so the print matches the preview.
   Chromium never has to rasterize CSS filters, which would print soft in PDFs.
6. **Vector where it matters.** Text, ornaments (inline SVG), masks (`clip-path`/`border-radius`),
   scrims (gradients) and crop marks stay vector in the PDF. Photos are embedded at their
   exact 300 DPI size.
7. **Proof what you print.** The Export Verification screen shows the real exported files
   (or a Ghostscript rasterization of the PDF itself) with a 100% zoom inspector. You
   approve the actual output, not an approximation of it.

---

## 4. Data flow for an export

```
POST /api/exports {projectId, options}
 └─ ExportRunner (queue; Chromium contexts limited by RENDER_CONCURRENCY)
     ├─ registers render job  → GET /api/render/jobs/:id (project + options)
     ├─ Chromium context(deviceScaleFactor = dpi/96, viewport = page size)
     │    └─ /render.html?job=:id → CardSurface pages → fonts.load + img.decode → __HC_RENDER__ ready
     ├─ PNG/JPEG: element screenshot per page → sharp (exact px, sRGB ICC, density) → file
     ├─ PDF: page.pdf(size = trim [+bleed] [+slug for crop marks]) → pdf-lib (TrimBox/BleedBox,
     │        OutputIntent sRGB) → optional Ghostscript CMYK (+ OutputIntent CMYK)
     │        → read back: page sizes, boxes, every font + whether its program is embedded
     ├─ proofs: 300 DPI PNG per page (Ghostscript rasterizes the actual PDF when available)
     └─ manifest.json in /data/exports/<date>_<card>_<format>/  → verification screen → download/zip
```

## 5. Photo sources and references

Photos are referenced by a portable string `ref`:

| Ref | Thumb / preview | Print source |
|---|---|---|
| `immich:<assetId>` | Immich `thumbnail` / `preview` (proxied with **your** key, re-encoded without metadata, cached per user) | Immich `original`, fetched into a per-render ephemeral folder and wiped afterwards (HEIC→`heic-convert`; RAW→Immich `fullsize`, falling back to `preview` with a DPI warning) |
| `library:shared/<path>` | generated by Sharp, cached in `/data/cache` | `/data/photos/shared/<path>` — every user |
| `library:users/<username>/<path>` | as above, only for that user | `/data/photos/users/<username>/<path>` |
| `upload:<path>` | as above, only for the uploader | `/data/uploads/<userId>/<path>` |

A ref is always resolved for the signed-in user (or the render job's owner): someone else's
`upload:` or `library:users/…` ref simply isn't found. Face boxes come from Immich
(`/api/faces`) when available. Otherwise the browser detects them once and the server caches
them, keyed by file identity.

## 6. Security model

The full model and verification steps are in
[SECURITY.md](SECURITY.md). In short:

* An `onRequest` guard requires a session on every route except `/login`, first-run `/setup`,
  optional `/register` and `/health`. Sessions are DB-backed (HMAC-stored tokens), cookies are
  `HttpOnly`/`SameSite=Lax`/auto-`Secure`; CSRF tokens on every state change; strict CSP.
* Every handler takes the user id from the session. Projects, uploads and exports live under
  `/<volume>/<userId>/` with DB ownership rows, so other users' ids resolve to 404.
* Immich: one `ReadOnlyImmichClient` with a hard method + endpoint allowlist (Layer 1), and keys
  with write permissions are refused when saved (Layer 2). Keys are AES-256-GCM encrypted per user.
* The headless renderer gets a per-job, read-only grant scoped to the job owner's data.
* Exports are scrubbed of EXIF/XMP/PDF metadata and re-verified; Immich originals used for a render
  are deleted in `finally`.
* SVGs are rebuilt from an allowlist before they are inlined; all file reads are canonicalised
  (`path.resolve` + root prefix + `realpath`). Zip imports are checked against zip-slip.
* Outbound stock-image requests: HTTPS, host allowlists, public IPs only (no SSRF).

---

## 7. PDF fidelity rules (verified against Chromium's PDF backend)

Chromium (Skia) writes vector PDFs, but some CSS forces it to rasterise. CardSurface is written
to stay on the vector path:

| Feature | How it is drawn | Result in the PDF |
|---|---|---|
| Text | Real DOM text with `@font-face` fonts | Embedded, subset TrueType/CFF fonts. Selectable, searchable, sharp at any zoom. |
| Foil text | `background: <gradient>` + `background-clip: text` | Vector gradient clipped to the glyph outlines |
| Ornaments | Inline, sanitised SVG recoloured with `currentColor` / `--hc-orn2` | Vector paths |
| Masks | `clip-path` (circle, ellipse, arch, heart, scallop, stamp) and `border-radius` | Vector clip around the image |
| Scrims and backgrounds | CSS gradients and solid colours | Vector shading |
| Photos | `<img>` of a server-made JPEG at the exact device-pixel size | JPEG passed through unchanged (no re-encoding) at the export DPI or better |
| Photo polish | **Never** CSS `filter` on content, which makes Chromium rasterise the whole subtree. Polish is baked into the JPEG by the server. | Same pixels as the PNG export |
| Shadows | Separate layers *behind* the content (`box-shadow`, `text-shadow`, a blurred silhouette for masked photos) | Only the soft shadow becomes an image. The text, foil or photo on top stays untouched. |
| Crop and fold marks | SVG lines in the slug area, 0.3 pt black (fold marks dashed), starting 1/16″ outside the bleed, plus a 5 pt info line | Vector. Never inside the bleed, never clipped by the page edge. |

Per-file post-processing:

* `pdf-lib` merges pages and sets `TrimBox`/`BleedBox`, metadata and an sRGB `OutputIntent`.
* For CMYK, Ghostscript converts with the chosen ICC profile and the OutputIntent is replaced.
* `inspectPdf()` reads the finished file back for the verification screen: page sizes, boxes,
  and fonts (Type0 → descendant `FontDescriptor` → `FontFile2`/`FontFile3`). If a font isn't
  embedded, the screen shows it in red.
* Each print image response carries `X-Source-Via` / `X-Source-Width`. The exporter records
  them, so the verification table shows whether a photo came from the original, a RAW
  full-size render or (with a warning) an Immich preview.

## 8. Editor UI structure

```
App
├─ ProjectsHome ─ NewCardModal (1 occasion → 2 family name, greeting style, size/fold/vendor)
└─ EditorScreen (key = projectId; opens/closes the document store)
   ├─ TopBar: ← home · name · Saved badge · undo/redo · Versions · duplicate
   │          · Guided|Studio · Editor|Preview · Guardian pill · settings · Export
   ├─ Sidebar
   │   ├─ Guided: 1 Occasion · 2 Photos [photos|layout|polish] · 3 Words & style
   │   │          [words|colors|fonts|finish] · 4 Check & print
   │   └─ Studio tabs: card · templates · photos · text · style · polish · decor · layers · check
   ├─ Canvas (CardSurface mode="editor", zoom via CSS transform, guides) | MockupView
   ├─ PagesBar (surface thumbnails, guides toggle, zoom −/Fit/+/1:1)
   ├─ Right panel: Inspector (selection) | GuardianPanel (studio, nothing selected)
   └─ GuardianHost (invisible: measures text ink/overflow/contrast for the rules)
Global modals: PhotoPicker · ExportModal (dialog → ExportVerification) · SettingsModal · Toasts
```

**Document store.** `store/editor.ts` holds the `CardProject` in Zustand with Immer.

* Every mutation goes through `commit`/`update`. Edits that share a *coalescing key* within
  900 ms merge into one undo step, so a slider drag or a run of typing is a single undo.
  Passing `null` as the key forces a separate step.
* Autosave PUTs the document 900 ms after the last change.
* The server keeps rolling version snapshots: automatic ones every few minutes, plus manual ones.

**Live assets.** `lib/assets.ts` loads fonts, style packs and health once. It reloads them
when the server sends an SSE event about changed files in `/data/fonts` or `/data/styles`, so
uploads and edits made on disk show up without a page reload.
