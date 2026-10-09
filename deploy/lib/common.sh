#!/usr/bin/env bash
# Shared helpers for deploy scripts. Source this file; do not run it.
# Works on macOS (bash 3.2, BSD tools) and Ubuntu 24.04.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
export REPO_DIR ZOOID_HOME

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() {
  printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2
  exit 1
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "missing command: $c"
  done
}

# file_mode <path>: print the octal permission bits (for example 600).
file_mode() {
  if [ "$(uname -s)" = "Darwin" ]; then
    stat -f %Lp "$1"
  else
    stat -c %a "$1"
  fi
}

# load_env <file>: export every KEY=VALUE line. Never prints values.
load_env() {
  local file="$1" line key val n=0
  [ -f "$file" ] || die "env file not found: $file"
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      '' | '#'*) continue ;;
    esac
    line="${line#export }"
    # Report only the line number: the line may be a pasted secret.
    case "$line" in
      *=*) ;;
      *) die "invalid line $n in $file (no '=')" ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    case "$key" in
      '' | [0-9]* | *[!A-Za-z0-9_]*) die "invalid key name on line $n in $file" ;;
    esac
    # Same rules as compose for the parts we support: quotes are removed, an
    # unquoted value ends at " #". Values must not contain `$`.
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
      *) val="${val%% #*}"; val="${val%"${val##*[![:space:]]}"}" ;;
    esac
    case "$val" in
      *\$*) die "value of $key on line $n in $file contains '\$' (not supported)" ;;
    esac
    export "$key=$val"
  done <"$file"
}

# require_env KEY...: die and list the names of unset or empty keys.
require_env() {
  local k missing=""
  for k in "$@"; do
    if [ -z "${!k:-}" ]; then
      missing="$missing $k"
    fi
  done
  [ -z "$missing" ] || die "missing required settings (in $ZOOID_HOME/.env or the environment):$missing"
}

# render_template [-m MODE] <template> <dest> VAR...: replace ${VAR} tokens for
# the listed vars only. MODE (default 644) is set before the file appears at dest.
render_template() {
  local mode=644 tpl dest tmp n
  if [ "$1" = "-m" ]; then
    mode="$2"
    shift 2
  fi
  tpl="$1" dest="$2"
  shift 2
  [ -f "$tpl" ] || die "template not found: $tpl"
  for n in "$@"; do
    [ -n "${!n+x}" ] || die "render $(basename "$tpl"): variable $n is not set"
    export "$n"
  done
  tmp="$(mktemp "${dest}.XXXXXX")" || die "cannot create temp file next to $dest"
  RENDER_VARS="$*" perl -pe '
    BEGIN { @v = split " ", $ENV{RENDER_VARS}; }
    for my $n (@v) { my $val = $ENV{$n}; s/\$\{\Q$n\E\}/$val/g; }
  ' "$tpl" >"$tmp" || { rm -f "$tmp"; die "render failed: $tpl"; }
  chmod "$mode" "$tmp"
  mv "$tmp" "$dest"
}

# compose "$@": uses --env-file only when $ZOOID_HOME/.env exists (checked at call time).
compose() {
  if [ -f "$ZOOID_HOME/.env" ]; then
    docker compose \
      --project-directory "$REPO_DIR/deploy" \
      --env-file "$ZOOID_HOME/.env" \
      -f "$REPO_DIR/deploy/docker-compose.yml" "$@"
  else
    docker compose \
      --project-directory "$REPO_DIR/deploy" \
      -f "$REPO_DIR/deploy/docker-compose.yml" "$@"
  fi
}

# wait_http <url> <timeout_s> [status-regex] [body-regex]: poll every 2 s. Returns 1 on timeout.
# WAIT_HTTP_HOST, when set, is sent as the Host header.
wait_http() {
  local url="$1" timeout="$2" accept="${3:-^2}" body_re="${4:-}"
  local deadline code body_file
  body_file="$(mktemp)"
  deadline=$(($(date +%s) + timeout))
  while :; do
    code="$(curl -s -o "$body_file" -w '%{http_code}' --max-time 5 \
      ${WAIT_HTTP_HOST:+-H "Host: $WAIT_HTTP_HOST"} "$url" 2>/dev/null || true)"
    if printf '%s' "$code" | grep -Eq "$accept"; then
      if [ -z "$body_re" ] || grep -Eq "$body_re" "$body_file"; then
        rm -f "$body_file"
        return 0
      fi
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      rm -f "$body_file"
      return 1
    fi
    sleep 2
  done
}
