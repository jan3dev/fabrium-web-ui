#!/usr/bin/env bash
# Back up the instance state under ZOOID_HOME into a tar.gz with a sha256 file.
set -euo pipefail

usage() {
  cat <<USAGE
Usage: backup.sh [--out DIR] [--no-stop] [--zooid-home DIR]

Stops zooid and tuwunel (restarts them on exit), then writes
zooid-<UTC timestamp>.tar.gz and .sha256 into DIR.

  --out DIR          output directory   (default: \$ZOOID_HOME/backups)
  --no-stop          do not stop the stack (not crash-consistent)
  --zooid-home DIR   instance data dir  (default: \$HOME/zooid)
  -h, --help         show this help
USAGE
}

OUT="${OUT:-}"
STOP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || { echo "--out needs a value" >&2; exit 1; }; OUT="$2"; shift 2 ;;
    --no-stop) STOP=0; shift ;;
    --zooid-home) [ $# -ge 2 ] || { echo "--zooid-home needs a value" >&2; exit 1; }; export ZOOID_HOME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

# shellcheck disable=SC1090
. "${COMMON_SH:-$(dirname "${BASH_SOURCE[0]}")/lib/common.sh}"

ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
[ -d "$ZOOID_HOME" ] || die "ZOOID_HOME not found: $ZOOID_HOME"
OUT="${OUT:-$ZOOID_HOME/backups}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
# The tarball holds .env and agent credentials: owner-only from the first byte.
umask 077

NAME="zooid-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
TARBALL="$OUT/$NAME"
PARTIAL="$TARBALL.partial"
STOPPED=0

cleanup() {
  # A failed run must not leave something that looks like a backup.
  rm -f "$PARTIAL"
  if [ "$STOPPED" -eq 1 ]; then
    log "Starting tuwunel and zooid"
    compose start tuwunel zooid || warn "could not restart the stack; run deploy.sh"
  fi
}
trap cleanup EXIT

if [ "$STOP" -eq 1 ]; then
  require_cmd docker
  log "Stopping zooid and tuwunel"
  STOPPED=1
  compose stop zooid tuwunel
else
  warn "--no-stop: the backup may be inconsistent while the stack runs"
fi

# Include list: skip entries that do not exist.
INCLUDES=()
for p in .env data/matrix/db data/matrix/media data/matrix/config \
         workforce/zooid.yaml workforce/data home workforce/agents; do
  if [ -e "$ZOOID_HOME/$p" ]; then
    INCLUDES+=("$p")
  else
    warn "not found, skipped: $p"
  fi
done
[ ${#INCLUDES[@]} -gt 0 ] || die "nothing to back up in $ZOOID_HOME"

EXCLUDES=(
  "--exclude=workforce/data/run"
  "--exclude=*/node_modules"
  "--exclude=*/.pnpm-store"
  "--exclude=*/.cache"
  "--exclude=*/.zooid/attachments"
)
# Git clones made by agents: workforce/agents/<agent>/<clone>/.git (depth 3
# exactly, so an agent workdir that is itself a git repo is kept).
if [ -d "$ZOOID_HOME/workforce/agents" ]; then
  while IFS= read -r g; do
    [ -n "$g" ] || continue
    rel="${g#"$ZOOID_HOME"/}"
    EXCLUDES+=("--exclude=$(dirname "$rel")")
  done < <(find "$ZOOID_HOME/workforce/agents" -mindepth 3 -maxdepth 3 -name .git 2>/dev/null)
fi

log "Writing $TARBALL"
# COPYFILE_DISABLE stops macOS tar from adding ._ metadata files.
COPYFILE_DISABLE=1 tar -C "$ZOOID_HOME" -czf "$PARTIAL" "${EXCLUDES[@]}" "${INCLUDES[@]}"
mv "$PARTIAL" "$TARBALL"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUT" && shasum -a 256 "$NAME" > "$NAME.sha256")
else
  die "neither sha256sum nor shasum found"
fi

log "Backup: $TARBALL"
log "Size:   $(du -h "$TARBALL" | cut -f1)"
log "Checksum file: $TARBALL.sha256"
log "Includes:"
for i in "${INCLUDES[@]}"; do log "  $i"; done
log "Excludes:"
for e in "${EXCLUDES[@]}"; do log "  ${e#--exclude=}"; done
