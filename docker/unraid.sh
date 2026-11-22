#!/bin/bash
# HomeCard on Unraid (or any Docker host) without Docker Compose.
#
#   bash docker/unraid.sh update    copy the source from HOMECARD_SOURCE (if set), build, restart
#   bash docker/unraid.sh rebuild   build from this folder as it is, then restart
#   bash docker/unraid.sh restart   recreate the container from the current image (after editing .env)
#   bash docker/unraid.sh stop | logs | status
#
# Run it from the folder you build in (e.g. /mnt/user/appdata/homecard-src). Settings come from
# .env in that folder; it is created on the first run with a new APP_ENCRYPTION_KEY. Host-side
# settings in .env:
#   HOMECARD_SOURCE  folder to copy the source from before building, e.g. a Nextcloud-synced copy
#                    (optional; the copy replaces everything here except .env and homecard-data/)
#   HOMECARD_DATA    where HomeCard keeps its data      (default /mnt/user/appdata/homecard)
#   PHOTOS_PATH      your photo folder, mounted read-only (default $HOMECARD_DATA/photos)
#   HOMECARD_PORT    port for the web UI                 (default 8787)
# Everything else in .env (APP_ENCRYPTION_KEY, IMMICH_URL, PUID, …) is passed to the container.
#
# The container gets the same protection as docker-compose.yml: read-only filesystem, /tmp in RAM,
# all Linux capabilities dropped except the four the entrypoint needs to hand the data folders to
# PUID:PGID, and no-new-privileges. The encryption key is passed through the environment, so it
# never appears in the docker command line or in an Unraid template on the flash drive.

set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
IMAGE="${HOMECARD_IMAGE:-homecard:latest}"
NAME="${HOMECARD_CONTAINER:-homecard}"

# Settings the server reads. Anything else in .env stays on the host.
CONTAINER_VARS=(
  APP_ENCRYPTION_KEY SESSION_SECRET ALLOW_REGISTRATION TRUST_PROXY HTTPS SESSION_IDLE_DAYS SESSION_MAX_DAYS
  IMMICH_URL PIXABAY_API_KEY UNSPLASH_API_KEY OPENVERSE_ENABLED
  PUID PGID UMASK TZ
  RENDER_CONCURRENCY CACHE_MAX_MB MAX_UPLOAD_MB WATCH WATCH_POLLING LOG_LEVEL
)

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# Value of KEY in .env: the last assignment wins; surrounding quotes, " # comments" and CRs removed.
env_get() {
  local key="$1" line val=""
  [ -f "$ENV_FILE" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in "$key="*) val="${line#*=}" ;; esac
  done <"$ENV_FILE"
  val="${val#"${val%%[![:space:]]*}"}"
  case "$val" in
    \"*\") val="${val:1:${#val}-2}" ;;
    \'*\') val="${val:1:${#val}-2}" ;;
    *)
      val="${val%%[[:space:]]#*}"
      val="${val%"${val##*[![:space:]]}"}"
      ;;
  esac
  printf '%s' "$val"
}

abs_path() {
  case "$1" in
    /*) printf '%s' "${1%/}" ;;
    *) printf '%s' "$APP_DIR/${1#./}" ;;
  esac
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    command -v openssl >/dev/null || die "openssl not found: create $ENV_FILE yourself (see .env.example)."
    (
      umask 077
      cat >"$ENV_FILE" <<EOF
# HomeCard settings for docker/unraid.sh. Every option is explained in .env.example.
APP_ENCRYPTION_KEY=$(openssl rand -base64 48)
HOMECARD_DATA=/mnt/user/appdata/homecard
PHOTOS_PATH=/mnt/user/appdata/homecard/photos
PUID=99
PGID=100
EOF
    )
    say "Created $ENV_FILE with a new APP_ENCRYPTION_KEY."
    warn "Save that key somewhere safe (password manager). Show it with: grep APP_ENCRYPTION_KEY $ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
  local key
  key="$(env_get APP_ENCRYPTION_KEY)"
  [ "${#key}" -ge 32 ] || die "APP_ENCRYPTION_KEY in $ENV_FILE is missing or shorter than 32 characters. Generate one with: openssl rand -base64 48"
}

load_paths() {
  local d p
  d="$(env_get HOMECARD_DATA)"
  DATA="$(abs_path "${d:-/mnt/user/appdata/homecard}")"
  p="$(env_get PHOTOS_PATH)"
  PHOTOS="$(abs_path "${p:-$DATA/photos}")"
  PORT="$(env_get HOMECARD_PORT)"
  PORT="${PORT:-8787}"
  case "$PORT" in '' | *[!0-9]*) die "HOMECARD_PORT must be a number (got \"$PORT\")." ;; esac
}

# Data and photos must never be inside the folder the copy step mirrors (it deletes extra files),
# except under homecard-data/, which the copy leaves alone.
check_not_mirrored() {
  local label="$1" dir="$2"
  case "$dir/" in
    "$APP_DIR/homecard-data/"*) ;;
    "$APP_DIR/"*) die "$label ($dir) is inside $APP_DIR, and the copy step would delete it. Point it somewhere else, e.g. /mnt/user/appdata/homecard." ;;
  esac
}

# Copy the source from HOMECARD_SOURCE into this folder. Returns 1 when there is nothing to copy.
sync_source() {
  local src
  src="$(env_get HOMECARD_SOURCE)"
  if [ -z "$src" ]; then
    say "HOMECARD_SOURCE isn't set in .env: building from $APP_DIR as it is."
    return 1
  fi
  src="$(abs_path "$src")"
  if [ ! -f "$src/Dockerfile" ] || [ ! -f "$src/package.json" ] || [ ! -f "$src/docker/entrypoint.sh" ]; then
    die "HOMECARD_SOURCE ($src) doesn't look like the HomeCard source: no Dockerfile, package.json or docker/entrypoint.sh there."
  fi
  if [ "$(readlink -f "$src")" = "$APP_DIR" ]; then
    say "HOMECARD_SOURCE is this folder: nothing to copy."
    return 1
  fi
  check_not_mirrored HOMECARD_DATA "$DATA"
  check_not_mirrored PHOTOS_PATH "$PHOTOS"
  command -v rsync >/dev/null || die "rsync not found."
  say "Copying the source from $src"
  rsync -a --delete --exclude /.env --exclude /homecard-data --exclude node_modules --exclude /.devdata "$src/" "$APP_DIR/"
}

build_image() {
  command -v docker >/dev/null || die "docker not found."
  OLD_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
  say "Building $IMAGE (the first build takes a few minutes)"
  docker build -t "$IMAGE" "$APP_DIR"
}

run_container() {
  command -v docker >/dev/null || die "docker not found."
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "There is no $IMAGE image yet. Run: bash $SELF rebuild"
  mkdir -p "$DATA/config" "$DATA/projects" "$DATA/uploads" "$DATA/exports" "$DATA/fonts" "$DATA/styles" "$DATA/cache" "$PHOTOS"

  # -e NAME (without =value) makes docker read the value from this process's environment.
  local -a envs=()
  local k v
  for k in "${CONTAINER_VARS[@]}"; do
    v="$(env_get "$k")"
    [ -n "$v" ] || continue
    export "$k=$v"
    envs+=(-e "$k")
  done
  for k in IMMICH_API_KEY AUTH_USERNAME AUTH_PASSWORD; do
    [ -z "$(env_get "$k")" ] || warn "$k in .env isn't used any more (and isn't passed on). You can remove it."
  done

  if docker container inspect "$NAME" >/dev/null 2>&1; then
    say "Replacing the $NAME container (your data stays in $DATA)"
    docker rm -f "$NAME" >/dev/null
  fi
  say "Starting $NAME (data: $DATA, photos: $PHOTOS read-only, port $PORT)"
  docker run -d --name "$NAME" --restart unless-stopped \
    -p "$PORT:8787" --shm-size=1g \
    --read-only --tmpfs /tmp:size=2g,mode=1777 \
    --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add SETUID --cap-add SETGID \
    --security-opt no-new-privileges:true --pids-limit 1024 \
    --log-opt max-size=10m --log-opt max-file=3 \
    --label 'net.unraid.docker.webui=http://[IP]:[PORT:8787]/' \
    "${envs[@]}" \
    -v "$DATA/config:/data/config" \
    -v "$DATA/projects:/data/projects" \
    -v "$DATA/uploads:/data/uploads" \
    -v "$DATA/exports:/data/exports" \
    -v "$DATA/fonts:/data/fonts" \
    -v "$DATA/styles:/data/styles" \
    -v "$DATA/cache:/data/cache" \
    -v "$PHOTOS:/data/photos:ro" \
    "$IMAGE" >/dev/null
}

lan_ip() {
  local ip=""
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')" || true
  printf '%s' "${ip:-$(hostname)}"
}

show_logs_and_fail() {
  warn "$1 Last log lines:"
  docker logs --tail 40 "$NAME" 2>&1 || true
  exit 1
}

wait_ready() {
  local i state
  say "Waiting for HomeCard to answer"
  for i in $(seq 1 45); do
    state="$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo missing)"
    [ "$state" = running ] || show_logs_and_fail "The container isn't running ($state)."
    if command -v curl >/dev/null; then
      if curl -fsS -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
        say "HomeCard is up: http://$(lan_ip):$PORT"
        return 0
      fi
    elif [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME" 2>/dev/null)" = healthy ]; then
      say "HomeCard is up: http://$(lan_ip):$PORT"
      return 0
    fi
    sleep 2
  done
  show_logs_and_fail "HomeCard didn't answer on port $PORT within 90 seconds."
}

remove_old_image() {
  local new
  new="$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
  if [ -n "${OLD_IMAGE_ID:-}" ] && [ "$OLD_IMAGE_ID" != "$new" ]; then
    if docker rmi "$OLD_IMAGE_ID" >/dev/null 2>&1; then say "Removed the previous image to free space."; fi
  fi
}

usage() {
  sed -n '2,8p' "$SELF" | sed 's/^# \{0,1\}//'
}

main() {
  local cmd="${1:-help}"
  case "$cmd" in
    update)
      ensure_env
      load_paths
      if sync_source; then
        # Continue with the freshly copied version of this script.
        exec bash "$SELF" rebuild
      fi
      main rebuild
      ;;
    rebuild)
      ensure_env
      load_paths
      build_image
      run_container
      wait_ready
      remove_old_image
      ;;
    restart)
      ensure_env
      load_paths
      run_container
      wait_ready
      ;;
    stop) docker stop "$NAME" ;;
    logs) docker logs -f --tail 100 "$NAME" ;;
    status)
      load_paths
      docker ps -a --filter "name=^/${NAME}\$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
      if command -v curl >/dev/null && curl -fsS -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
        say "Answering on http://$(lan_ip):$PORT"
      else
        warn "Not answering on port $PORT."
      fi
      ;;
    help | -h | --help) usage ;;
    *)
      usage
      exit 1
      ;;
  esac
}

# Everything runs from main(), which bash has read in full before it starts: the copy step can
# safely replace this file while it runs.
main "$@"
