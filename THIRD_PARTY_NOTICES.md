# Third-party notices

HomeCard's own code is MIT licensed (see [LICENSE](LICENSE)). It is built on, and the Docker
image contains, the third-party software and content below. Each keeps its own licence.

## npm packages

Installed by `npm ci` from the public registry; their licence texts ship inside `node_modules`.
Almost all are MIT, ISC, BSD or Apache-2.0. The ones worth knowing about:

| Package | Licence | Notes |
|---|---|---|
| fastify, @fastify/static, @fastify/multipart, chokidar, adm-zip, fontkit, pdf-lib | MIT | server |
| react, react-dom, zustand, immer, clsx, vite, tailwindcss | MIT | web app and build |
| lucide-react | ISC | icons |
| @vladmandic/face-api (library and the bundled model weights) | MIT | in-browser face detection for smart cropping; runs locally, nothing is sent anywhere |
| playwright (+ the Chromium build it downloads) | Apache-2.0 (Chromium: BSD-style and others) | headless renderer for print files |
| sharp | Apache-2.0 | image processing. Its prebuilt **libvips** binaries are **LGPL-3.0**, dynamically linked and unmodified; their source is at <https://github.com/libvips/libvips> |
| heic-convert → libheif-js | ISC → **LGPL-3.0** | HEIC/HEIF photo decoding; unmodified, source at <https://github.com/catdad-experiments/libheif-js> |

## Fonts

The bundled font families come from [Fontsource](https://fontsource.org) packages and are under
the **SIL Open Font License 1.1** (a few under Apache-2.0). The build copies each family's
licence file into `apps/server/assets/fonts/licenses/`, which ships inside the Docker image.
The OFL allows bundling the fonts with software and using them in printed work; the fonts may not
be sold on their own.

## Starter Style Packs

All bundled style packs in `data/styles/*` are released under **CC0-1.0**.

* The four starter packs (`classic-paper`, `gilded-holiday`, `spring-garden`, `winter-woodland`):
  textures, ornaments and stickers generated procedurally for HomeCard
  (`scripts/generate-textures.mjs`).
* The twelve collections (`winter-holidays`, `new-year-parties`, `lights-and-faith`,
  `spring-easter`, `mothers-fathers-day`, `summer`, `autumn-harvest`, `halloween`,
  `love-weddings`, `baby-birthdays`, `milestones`, `everyday-styles`): palettes, SVG artwork,
  layouts and procedural textures created with the help of an AI assistant, then checked,
  de-duplicated, merged and fixed for HomeCard. They contain no third-party images, logos or
  trademarks.

## Docker image (system packages)

The runtime image is based on `node:<version>-bookworm-slim` (Debian) and installs these
unmodified Debian packages:

| Package | Licence | Notes |
|---|---|---|
| ghostscript | **AGPL-3.0** | runs as a separate program for CMYK PDF conversion and proofs. HomeCard doesn't link to it or modify it. If you **publish** a built image (for example to a container registry), the AGPL asks you to make the corresponding Ghostscript source available; Debian's source packages (`apt-get source ghostscript`) satisfy that. |
| tini | MIT | init process |
| fonts-noto-color-emoji | OFL-1.1 | emoji in text |
| fonts-dejavu-core | Bitstream Vera / public domain | fallback font |
| util-linux, ca-certificates | GPL-2.0+ / MPL-2.0 | `setpriv` for dropping privileges; CA bundle |

## Online image services (optional)

HomeCard can search Pixabay, Unsplash and Openverse with **your own** API keys. The images you
pick there are covered by those services' licences and terms, not by HomeCard's licence. See
[README → Legal notes](README.md#legal-notes).
