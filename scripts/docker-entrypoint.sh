#!/bin/sh
set -eu

DATA_DIR="${EIDON_DATA_DIR:-/app/data}"
HOME_DIR="${HOME:-$DATA_DIR/home}"
TMP_DIR="${TMPDIR:-$DATA_DIR/tmp}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-$DATA_DIR/runtime}"
SOCKET_DIR="${AGENT_BROWSER_SOCKET_DIR:-$DATA_DIR/runtime/agent-browser}"
WORKSPACES_DIR="$DATA_DIR-workspaces"
NEXT_CACHE_DIR="/app/.next/cache"

log() {
  echo "[docker-entrypoint] $*"
}

warn() {
  echo "[docker-entrypoint] WARNING: $*" >&2
}

die() {
  echo "[docker-entrypoint] ERROR: $*" >&2
  exit 1
}

if [ "$(id -u)" -eq 0 ]; then
  if [ -n "${PUID:-}" ] || [ -n "${PGID:-}" ]; then
    if [ -z "${PUID:-}" ] || [ -z "${PGID:-}" ]; then
      die "PUID and PGID must be set together"
    fi
    case "$PUID" in
      *[!0-9]* | "") die "PUID must be a positive integer, got '$PUID'" ;;
    esac
    case "$PGID" in
      *[!0-9]* | "") die "PGID must be a positive integer, got '$PGID'" ;;
    esac
    if [ "$PUID" -eq 0 ]; then
      die "PUID must not be 0; the app refuses to run as root"
    fi
    if [ "$PGID" -eq 0 ]; then
      die "PGID must not be 0; the app refuses to run as root"
    fi
    if [ "$PUID" -ne "$(id -u eidon)" ] || [ "$PGID" -ne "$(id -g eidon)" ]; then
      log "remapping eidon to uid $PUID gid $PGID"
      groupmod -o -g "$PGID" eidon
      usermod -o -u "$PUID" -g "$PGID" eidon
    fi
  fi

  for dir in "$DATA_DIR" "$HOME_DIR" "$TMP_DIR" "$RUNTIME_DIR" "$SOCKET_DIR" "$WORKSPACES_DIR" "$NEXT_CACHE_DIR"; do
    mkdir -p -m 700 "$dir"
  done

  fix_dirs=""
  add_fix_dir() {
    case " $fix_dirs " in
      *" $1 "*) ;;
      *) fix_dirs="$fix_dirs $1" ;;
    esac
  }
  add_fix_dir "$DATA_DIR"
  [ "$DATA_DIR" = /app/data ] || add_fix_dir /app/data
  add_fix_dir "$WORKSPACES_DIR"
  add_fix_dir "$NEXT_CACHE_DIR"
  for dir in $fix_dirs; do
    find "$dir" -xdev \( ! -user eidon -o ! -group eidon \) -exec chown -h eidon:eidon {} + 2>/dev/null ||
      warn "could not fix ownership under $dir (NFS or SMB mount?); continuing"
  done

  exec setpriv --reuid=eidon --regid=eidon --init-groups "$@"
fi

if [ -n "${PUID:-}" ] || [ -n "${PGID:-}" ]; then
  warn "PUID/PGID are ignored because the container was started as a non-root user"
fi
for dir in "$DATA_DIR" "$HOME_DIR" "$TMP_DIR" "$RUNTIME_DIR" "$SOCKET_DIR" "$WORKSPACES_DIR" "$NEXT_CACHE_DIR"; do
  mkdir -p -m 700 "$dir" 2>/dev/null || warn "could not create $dir"
done
exec "$@"
