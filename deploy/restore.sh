#!/usr/bin/env bash
# Restore a backup.sh tarball into ZOOID_HOME. The stack must be stopped.
set -euo pipefail

usage() {
  cat <<USAGE
Usage: restore.sh <tarball> [--force] [--zooid-home DIR]

Verifies the .sha256 next to the tarball, then extracts it into ZOOID_HOME.

  --force            overwrite an existing .env or non-empty data/matrix/db
  --zooid-home DIR   instance data dir (default: \$HOME/zooid)
  -h, --help         show this help
USAGE
}

TARBALL=""
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --zooid-home) [ $# -ge 2 ] || { echo "--zooid-home needs a value" >&2; exit 1; }; export ZOOID_HOME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage >&2; echo "unknown argument: $1" >&2; exit 1 ;;
    *) [ -z "$TARBALL" ] || { echo "only one tarball allowed" >&2; exit 1; }; TARBALL="$1"; shift ;;
  esac
done
[ -n "$TARBALL" ] || { usage >&2; echo "tarball is required" >&2; exit 1; }

# shellcheck disable=SC1090
. "${COMMON_SH:-$(dirname "${BASH_SOURCE[0]}")/lib/common.sh}"

ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"
TAR_DIR="$(cd "$(dirname "$TARBALL")" && pwd)"
TAR_NAME="$(basename "$TARBALL")"

# Checksum
if [ -f "$TAR_DIR/$TAR_NAME.sha256" ]; then
  log "Verifying checksum"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$TAR_DIR" && sha256sum -c "$TAR_NAME.sha256" >/dev/null) || die "checksum mismatch for $TAR_NAME"
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$TAR_DIR" && shasum -a 256 -c "$TAR_NAME.sha256" >/dev/null) || die "checksum mismatch for $TAR_NAME"
  else
    die "neither sha256sum nor shasum found"
  fi
else
  warn "no $TAR_NAME.sha256 found; checksum not verified"
fi

# The stack must be stopped. `compose ps` needs the instance variables; when it
# cannot run, ask the engine directly by project label.
PROJECT="${COMPOSE_PROJECT_NAME:-fabrium}"
if RUNNING="$(compose ps -q 2>/dev/null)"; then
  :
else
  RUNNING="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)"
fi
[ -z "$RUNNING" ] || die "containers of project $PROJECT are running. Run 'deploy/compose.sh down' first."

DB="$ZOOID_HOME/data/matrix/db"
if [ "$FORCE" -ne 1 ]; then
  if [ -d "$DB" ] && [ -n "$(ls -A "$DB" 2>/dev/null)" ]; then
    die "$DB is not empty. Use --force to overwrite."
  fi
  [ ! -e "$ZOOID_HOME/.env" ] || die "$ZOOID_HOME/.env exists. Use --force to overwrite."
elif [ -d "$DB" ] && [ -n "$(ls -A "$DB" 2>/dev/null)" ]; then
  # Extracting over a RocksDB directory would mix two databases: move it aside.
  ASIDE="$DB.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  warn "--force: moving the existing database to $ASIDE"
  mv "$DB" "$ASIDE"
fi

mkdir -p "$ZOOID_HOME"
log "Extracting $TAR_NAME into $ZOOID_HOME"
tar -C "$ZOOID_HOME" -xzf "$TARBALL"

[ ! -f "$ZOOID_HOME/.env" ] || chmod 600 "$ZOOID_HOME/.env"
for f in "$ZOOID_HOME"/data/matrix/config/registrations/*.yaml; do
  [ -f "$f" ] && chmod 600 "$f"
done

# Compare key names with .env.example (names only, never values).
EXAMPLE="$REPO_DIR/deploy/.env.example"
if [ -f "$ZOOID_HOME/.env" ] && [ -f "$EXAMPLE" ]; then
  keys() { grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" | cut -d= -f1 | sort -u; }
  MISSING="$(comm -13 <(keys "$ZOOID_HOME/.env") <(keys "$EXAMPLE"))"
  if [ -n "$MISSING" ]; then
    warn "keys in .env.example that the restored .env lacks:"
    printf '%s\n' "$MISSING" | sed 's/^/  /' >&2
    warn "A prod .env from the old layout lacks SITE_ADDRESS, HOMESERVER_URL and similar keys. Add them."
  else
    log ".env has every key of .env.example"
  fi
elif [ ! -f "$ZOOID_HOME/.env" ]; then
  warn "the tarball has no .env; create one before deploy"
fi

YAML="$ZOOID_HOME/workforce/zooid.yaml"
if [ -f "$YAML" ]; then
  grep -E '^[[:space:]]*homeserver:' "$YAML" | sed 's/#.*//' | grep -Eq 'localhost|127\.0\.0\.1' &&
    warn "zooid.yaml homeserver points to localhost; use 'homeserver: http://tuwunel:8448'"
  grep -Eq '^[[:space:]]*runtime:[[:space:]]*podman' "$YAML" && warn "zooid.yaml has 'runtime: podman'; use 'runtime: docker'"
fi

log "deploy.sh re-renders tuwunel.toml, the registration and config.json from .env."
log "zooid.yaml must use 'homeserver: http://tuwunel:8448' and 'runtime: docker'."
log "Next: deploy/deploy.sh"
