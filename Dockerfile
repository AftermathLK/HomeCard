# syntax=docker/dockerfile:1.7
#
# HomeCard — production image
#   * build stage: installs the whole workspace, collects bundled fonts + face model,
#     builds the React app (Vite) and bundles the Node server (esbuild)
#   * runtime stage: Node 24 + headless Chromium (Playwright) + Ghostscript, production deps only
#   * the server never runs as root: the entrypoint fixes volume ownership, then drops to
#     PUID:PGID (default 99:100) with setpriv. Or start it directly as a user (compose `user:`).
#
# docker build -t homecard .

# Node 24.7+ is required: HomeCard uses the built-in node:sqlite and crypto.argon2 (no native addons).
ARG NODE_VERSION=24

############################ build ############################
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
ENV CI=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first (cached unless a package.json / lockfile changes).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# A lockfile written on another OS can miss Linux-only optional binaries (esbuild, rolldown,
# lightningcss, sharp); fall back to a fresh resolve in that case.
RUN npm ci --no-audit --no-fund || (rm -rf node_modules && npm install --no-audit --no-fund)

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY scripts scripts

# Fonts (from @fontsource) + face-detection model -> served assets; then web + server builds.
RUN npm run build \
 && test -f apps/web/dist/index.html \
 && test -f apps/web/dist/render.html \
 && test -f apps/web/dist/auth.html \
 && test -f apps/web/dist/.vite/manifest.json \
 && test -f apps/server/dist/server.js \
 && test -f apps/server/dist/cli.js \
 && test -f apps/server/assets/fonts/manifest.json \
 && test -f apps/web/dist/vendor/face-api/ssd_mobilenetv1_model-weights_manifest.json

############################ runtime ############################
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PUID=99 \
    PGID=100 \
    UMASK=027 \
    TZ=Etc/UTC \
    EPHEMERAL_DIR=/tmp/homecard-ephemeral

# Ghostscript: CMYK PDF conversion + PDF proofs. tini: proper PID 1 (reaps Chromium children).
# fonts-noto-color-emoji: emoji in card text. util-linux provides setpriv for PUID/PGID.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ghostscript tini fonts-noto-color-emoji fonts-dejavu-core ca-certificates util-linux \
 && rm -rf /var/lib/apt/lists/*

# Production dependencies of the server only.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN (npm ci --omit=dev --no-audit --no-fund -w @homecard/server --include-workspace-root=false \
     || npm install --omit=dev --no-audit --no-fund -w @homecard/server --include-workspace-root=false) \
 && npm cache clean --force

# Headless Chromium matching the installed Playwright version, plus its system libraries.
RUN npx --no-install playwright install --with-deps --only-shell chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/server/assets apps/server/assets
COPY --from=build /src/apps/web/dist apps/web/dist
# Starter kit (style packs, schema, fonts README) — seeded into /data on first start.
COPY data data
COPY docker/entrypoint.sh /usr/local/bin/homecard-entrypoint
RUN chmod 755 /usr/local/bin/homecard-entrypoint \
 && mkdir -p /data/projects /data/uploads /data/photos /data/fonts /data/styles /data/exports /data/config /data/cache

# Every folder HomeCard writes to is a volume, so the container's own filesystem can be read-only.
VOLUME ["/data/projects", "/data/uploads", "/data/photos", "/data/fonts", "/data/styles", "/data/exports", "/data/config", "/data/cache"]
EXPOSE 8787

# /health is the only unauthenticated endpoint and returns just {"status":"ok"}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/homecard-entrypoint"]
CMD ["node", "--enable-source-maps", "apps/server/dist/server.js"]
