#!/bin/sh
# HomeCard container entrypoint.
#  * creates the /data layout
#  * when started as root, hands the writable folders to PUID:PGID (Unraid default 99:100)
#    and drops privileges with setpriv: the server never runs as root
#  * when started as a non-root user (docker run --user / compose `user:`), just execs
#
# Root here needs only CHOWN, DAC_OVERRIDE, SETUID and SETGID (see docker-compose.yml cap_add);
# after setpriv the server process has no capabilities at all.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-99}"
PGID="${PGID:-100}"
UMASK="${UMASK:-027}"

# Folders HomeCard writes to. /data/photos (your library) is only ever read and can be mounted :ro.
WRITABLE="projects uploads exports config cache fonts styles"

case "$UMASK" in ''|*[!0-7]*) echo "homecard: UMASK must be octal (e.g. 027)" >&2; exit 1 ;; esac
# New files: owner read/write, group read, nothing for others (cards and exports are private).
umask "$UMASK"

for d in $WRITABLE photos; do
  mkdir -p "$DATA_DIR/$d" 2>/dev/null || true
done

if [ "$(id -u)" = "0" ]; then
  case "$PUID" in ''|*[!0-9]*) echo "homecard: PUID must be numeric" >&2; exit 1 ;; esac
  case "$PGID" in ''|*[!0-9]*) echo "homecard: PGID must be numeric" >&2; exit 1 ;; esac
  if [ "$PUID" = "0" ]; then echo "homecard: refusing to run as root (PUID=0). Use e.g. PUID=99 PGID=100." >&2; exit 1; fi

  for d in $WRITABLE; do
    target="$DATA_DIR/$d"
    # Only re-own folders that aren't already owned by the runtime user (keeps restarts fast).
    if [ "$(stat -c '%u:%g' "$target")" != "$PUID:$PGID" ]; then
      echo "homecard: setting owner of $target to $PUID:$PGID"
      chown -R "$PUID:$PGID" "$target" || echo "homecard: warning: could not chown $target (read-only or network share?)" >&2
    fi
  done

  # Chromium needs a writable HOME for its profile/crash dirs (on the /tmp tmpfs).
  # Set the mode while root still owns the folder: after the chown, chmod would need
  # CAP_FOWNER, which this container deliberately doesn't have.
  export HOME=/tmp/homecard-home
  mkdir -p "$HOME"
  if [ "$(stat -c '%u:%g' "$HOME")" != "$PUID:$PGID" ]; then
    chmod 700 "$HOME"
    chown "$PUID:$PGID" "$HOME"
  fi

  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups --inh-caps=-all -- "$@"
fi

export HOME="${HOME:-/tmp/homecard-home}"
mkdir -p "$HOME" 2>/dev/null || true
exec "$@"
