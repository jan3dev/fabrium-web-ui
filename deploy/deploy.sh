#!/usr/bin/env bash
# Deploy or update the Fabrium stack on this machine.
set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

CONTEXT_MCP_DIST_IN_IMAGE="${CONTEXT_MCP_DIST_IN_IMAGE:-/app/packages/context-mcp/dist}"
AGENT_IMAGES="agent-base agent-opencode agent-claude-code agent-codex agent-pi"

NO_PULL=0
NO_BUILD=0
REFRESH_AGENTS=0
REF=""

usage() {
  cat <<USAGE
Usage: deploy/deploy.sh [--no-pull] [--no-build] [--refresh-agent-images] [--ref <branch>] [-h]

  --no-pull               skip git fetch and pull
  --no-build              skip docker compose build (images must exist)
  --refresh-agent-images  docker pull the ghcr.io/zooid-ai/agent-* images (:latest)
  --ref <branch>          check out this branch before pulling
  -h                      show this help

Environment: ZOOID_HOME (default \$HOME/zooid), CONTEXT_MCP_DIST_IN_IMAGE.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) NO_PULL=1 ;;
    --no-build) NO_BUILD=1 ;;
    --refresh-agent-images) REFRESH_AGENTS=1 ;;
    --ref)
      [ $# -ge 2 ] || die "--ref needs a branch name"
      REF="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done
if [ -n "$REF" ] && [ "$NO_PULL" -eq 1 ]; then
  die "--ref needs a pull; drop --no-pull or check out the branch yourself"
fi

# --- 1. preflight ---------------------------------------------------------
require_cmd docker git curl perl
docker compose version >/dev/null 2>&1 || die "'docker compose' (v2 plugin) is not available"

ENV_FILE="$ZOOID_HOME/.env"
if [ -f "$ENV_FILE" ]; then
  if [ "$(file_mode "$ENV_FILE")" != "600" ]; then
    warn "$ENV_FILE mode is not 600; fixing"
    chmod 600 "$ENV_FILE"
  fi
  load_env "$ENV_FILE"
else
  warn "no $ENV_FILE; using variables from the current environment"
fi
require_env SERVER_NAME SITE_ADDRESS HOMESERVER_URL MATRIX_AS_TOKEN MATRIX_HS_TOKEN
export SERVER_NAME SITE_ADDRESS HOMESERVER_URL MATRIX_AS_TOKEN MATRIX_HS_TOKEN

# Values go into TOML, YAML and JSON unescaped: allow only safe characters,
# and refuse the placeholders of .env.example.
for k in SERVER_NAME SITE_ADDRESS HOMESERVER_URL MATRIX_AS_TOKEN MATRIX_HS_TOKEN; do
  case "${!k}" in
    '<'*'>') die "$k still has the placeholder from .env.example" ;;
    *[\"\'\\\$\`]*) die "$k must not contain quotes, backslashes, \$ or backticks" ;;
  esac
done
printf '%s' "$SERVER_NAME" | grep -Eq '^[A-Za-z0-9.-]+(:[0-9]+)?$' || die "SERVER_NAME is not a host name"
printf '%s' "$MATRIX_AS_TOKEN$MATRIX_HS_TOKEN" | grep -Eq '^[A-Za-z0-9_-]+$' || die "Matrix tokens must be [A-Za-z0-9_-]"
if [ -f "$ENV_FILE" ]; then
  left="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=<' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ' || true)"
  [ -z "$left" ] || warn "placeholders still in $ENV_FILE: $left"
fi
case "$ZOOID_HOME" in
  /*) ;;
  *) die "ZOOID_HOME must be an absolute path (it is bind-mounted at the same path): $ZOOID_HOME" ;;
esac
if [ "$(id -u)" = "0" ] && [ -z "${DAEMON_UID:-}" ]; then
  die "do not run deploy.sh as root (files under ZOOID_HOME would become root-owned); set DAEMON_UID to override"
fi

export WORKFORCE_SPACE="${WORKFORCE_SPACE:-dev}"
export APPSERVICE_PORT="${APPSERVICE_PORT:-9000}"
export TUWUNEL_BIND="${TUWUNEL_BIND:-127.0.0.1:8448}"
export HTTP_PORT="${HTTP_PORT:-80}"
export HTTPS_PORT="${HTTPS_PORT:-443}"

YAML="$ZOOID_HOME/workforce/zooid.yaml"
[ -f "$YAML" ] || die "$YAML not found (copy deploy/templates/zooid.yaml.example)"

# matrix_key <key>: value of transports.matrix.<key> in zooid.yaml, comments
# and quotes stripped. Keys are matched inside the `matrix:` block only.
matrix_key() {
  awk -v key="$1" '
    function indent(s) { match(s, /^[ ]*/); return RLENGTH }
    /^[ ]*#/ || /^[ ]*$/ { next }
    { sub(/[ ]+#.*$/, "") }
    /^transports:/ { in_t = 1; next }
    in_t && indent($0) == 0 { in_t = 0 }
    in_t && $1 == "matrix:" { in_m = 1; m_ind = indent($0); next }
    in_m && indent($0) <= m_ind { in_m = 0 }
    in_m && $1 == key ":" { v = $0; sub(/^[^:]*:[ ]*/, "", v); gsub(/^["'"'"']|["'"'"']$/, "", v); print v; exit }
  ' "$YAML"
}

yaml_port="$(matrix_key port)"
if [ -n "$yaml_port" ] && [ "$yaml_port" != "$APPSERVICE_PORT" ]; then
  die "zooid.yaml transports.matrix.port ($yaml_port) must equal APPSERVICE_PORT ($APPSERVICE_PORT)"
fi

ns_val="$(matrix_key user_namespace)"
if [ -n "$ns_val" ]; then
  # '@.*:fabrium\.net' -> fabrium.net
  ns_host="$(printf '%s' "${ns_val##*:}" | sed 's/\\//g')"
  [ "$ns_host" = "$SERVER_NAME" ] ||
    die "zooid.yaml user_namespace host ($ns_host) must equal SERVER_NAME ($SERVER_NAME)"
fi

hs_val="$(matrix_key homeserver)"
if printf '%s' "$hs_val" | grep -Eq 'localhost|127\.0\.0\.1'; then
  die "zooid.yaml homeserver points to localhost; inside the container use 'homeserver: http://tuwunel:8448'"
fi

RUN_DIR="$ZOOID_HOME/workforce/data/run"
if [ "${#RUN_DIR}" -gt 81 ]; then
  die "run dir path is ${#RUN_DIR} chars (max 81, Unix socket limit): choose a shorter ZOOID_HOME"
fi

# --- 2. git ---------------------------------------------------------------
BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
OLD_SHA="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"

if [ "$NO_PULL" -eq 0 ]; then
  log "git fetch"
  git -C "$REPO_DIR" fetch --prune origin
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
    die "working tree in $REPO_DIR has uncommitted changes; commit or stash them"
  fi
  if [ -n "$REF" ] && [ "$REF" != "$BRANCH" ]; then
    git -C "$REPO_DIR" checkout "$REF"
    BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
  fi
  [ "$BRANCH" != "HEAD" ] || die "detached HEAD; use --ref <branch>"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
else
  log "--no-pull: skipping fetch and pull"
fi

NEW_SHA="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
if [ "$OLD_SHA" != "$NEW_SHA" ]; then
  log "updated $OLD_SHA -> $NEW_SHA"
  git -C "$REPO_DIR" log --oneline "$OLD_SHA..$NEW_SHA" || true
else
  log "no new commits ($NEW_SHA)"
fi

export GIT_SHA="$NEW_SHA"
DAEMON_UID="${DAEMON_UID:-$(id -u)}"
DAEMON_GID="${DAEMON_GID:-$(id -g)}"
export DAEMON_UID DAEMON_GID

# --- 3. layout and rendered files -----------------------------------------
for d in data/matrix/db data/matrix/media data/matrix/config/registrations \
  workforce/agents workforce/data home web app/context-mcp backups; do
  mkdir -p "$ZOOID_HOME/$d"
done

TPL="$REPO_DIR/deploy/templates"

render_web_config() {
  local vapid="$ZOOID_HOME/workforce/data/vapid.json" key=""
  if [ -f "$vapid" ]; then
    key="$(sed -n 's/.*"publicKey"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$vapid" | head -1)"
  fi
  if [ -n "$key" ]; then
    VAPID_PUBLIC_KEY="$key"
    export VAPID_PUBLIC_KEY
    render_template "$TPL/config.push.json" "$ZOOID_HOME/web/config.json" \
      SERVER_NAME APPSERVICE_PORT HOMESERVER_URL WORKFORCE_SPACE VAPID_PUBLIC_KEY
  else
    render_template "$TPL/config.json" "$ZOOID_HOME/web/config.json" \
      SERVER_NAME APPSERVICE_PORT HOMESERVER_URL WORKFORCE_SPACE
  fi
}

log "rendering config files"
# The registration namespaces are regexes: escape the dots of the server name.
SERVER_NAME_RE="$(printf '%s' "$SERVER_NAME" | sed 's/\./\\./g')"
export SERVER_NAME_RE
render_template "$TPL/tuwunel.toml" "$ZOOID_HOME/data/matrix/config/tuwunel.toml" \
  SERVER_NAME APPSERVICE_PORT HOMESERVER_URL WORKFORCE_SPACE
REG="$ZOOID_HOME/data/matrix/config/registrations/zooid.yaml"
render_template -m 600 "$TPL/registration.yaml" "$REG" \
  SERVER_NAME_RE APPSERVICE_PORT MATRIX_AS_TOKEN MATRIX_HS_TOKEN
render_web_config

# --- 4. build -------------------------------------------------------------
if [ "$NO_BUILD" -eq 0 ]; then
  log "building images (GIT_SHA=$GIT_SHA)"
  # Reproducible image IDs: with cached layers, a rebuild must give the same
  # ID, or `compose up` recreates the containers on every deploy. BuildKit's
  # default attestations and the export timestamp both change the ID.
  SOURCE_DATE_EPOCH="$(git -C "$REPO_DIR" log -1 --format=%ct HEAD)"
  export SOURCE_DATE_EPOCH BUILDX_NO_DEFAULT_ATTESTATIONS=1
  compose build --build-arg GIT_SHA="$GIT_SHA" --build-arg SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH"
else
  log "--no-build: skipping image build"
fi

# --- 5. docker socket gid -------------------------------------------------
IMAGE="fabrium-zooid:${GIT_SHA}"
DOCKER_GID="$(docker run --rm -v /var/run/docker.sock:/s --entrypoint stat "$IMAGE" -c %g /s)" ||
  die "cannot read docker socket gid from image $IMAGE"
export DOCKER_GID

# --- 6. context-mcp dist for agent mounts ---------------------------------
log "copying context-mcp dist out of $IMAGE"
# Into a fresh directory, then swap: no stale files, and running agents keep
# the directory they mounted.
CTX_NEW="$ZOOID_HOME/app/context-mcp.new"
rm -rf "$CTX_NEW"
mkdir -p "$CTX_NEW"
cid="$(docker create "$IMAGE")"
if ! docker cp "$cid:${CONTEXT_MCP_DIST_IN_IMAGE}/." "$CTX_NEW/"; then
  docker rm "$cid" >/dev/null 2>&1 || true
  rm -rf "$CTX_NEW"
  die "docker cp failed: ${CONTEXT_MCP_DIST_IN_IMAGE} not found in image (set CONTEXT_MCP_DIST_IN_IMAGE)"
fi
docker rm "$cid" >/dev/null
[ -f "$CTX_NEW/bin.js" ] || die "no bin.js in ${CONTEXT_MCP_DIST_IN_IMAGE}"
rm -rf "$ZOOID_HOME/app/context-mcp.old"
[ ! -d "$ZOOID_HOME/app/context-mcp" ] || mv "$ZOOID_HOME/app/context-mcp" "$ZOOID_HOME/app/context-mcp.old"
mv "$CTX_NEW" "$ZOOID_HOME/app/context-mcp"
rm -rf "$ZOOID_HOME/app/context-mcp.old"

# --- 7. start and wait ----------------------------------------------------
# A bind-mounted file does not make compose recreate a container, but a label
# does: hash what each service reads at start, so only the affected one restarts.
CONFIG_HASH_ZOOID="$(cat "$YAML" "$REG" | shasum -a 256 | cut -c1-12)"
CONFIG_HASH_TUWUNEL="$(cat "$ZOOID_HOME/data/matrix/config/tuwunel.toml" "$REG" | shasum -a 256 | cut -c1-12)"
export CONFIG_HASH_ZOOID CONFIG_HASH_TUWUNEL
log "starting stack (config hashes zooid=$CONFIG_HASH_ZOOID tuwunel=$CONFIG_HASH_TUWUNEL)"
compose up -d --remove-orphans

fail_wait() {
  warn "timeout waiting for $1"
  compose ps || true
  compose logs --tail 50 "$1" || true
  exit 1
}

log "waiting for services"
wait_http "http://${TUWUNEL_BIND}/_matrix/client/versions" 120 '^2' || fail_wait tuwunel
# The daemon pulls every agent image it does not have before it listens, so a
# first start on a new box can take minutes.
log "waiting for zooid (up to 600 s; a first start pulls the agent images)"
wait_http "http://127.0.0.1:${APPSERVICE_PORT}/healthz" 600 '^2' '^ok' || fail_wait zooid
# Caddy matches sites by Host: send the configured one (a plain HTTP site such
# as ":80" has no host, so any value works there). A domain site redirects to
# HTTPS, hence 3xx is accepted.
SITE_HOST="$(printf '%s' "$SITE_ADDRESS" | sed -E 's#^[a-z]+://##; s#:[0-9]+$##; s#/.*$##')"
WAIT_HTTP_HOST="${SITE_HOST:-localhost}" \
  wait_http "http://127.0.0.1:${HTTP_PORT}/config.json" 120 '^[23]' || fail_wait web

# --- 8. re-render web config (vapid key may exist now) --------------------
render_web_config

# --- 9. agent images ------------------------------------------------------
if [ "$REFRESH_AGENTS" -eq 1 ]; then
  for a in $AGENT_IMAGES; do
    log "pulling ghcr.io/zooid-ai/$a:latest"
    docker pull "ghcr.io/zooid-ai/$a:latest" || warn "pull failed: $a"
  done
fi

# --- 10. summary ----------------------------------------------------------
log "deploy ok: branch=$BRANCH $OLD_SHA -> $NEW_SHA"
compose ps
printf '%s branch=%s sha=%s ok\n' "$(date -u +%FT%TZ)" "$BRANCH" "$NEW_SHA" >>"$ZOOID_HOME/deploy.log"

# Keep the images of this deploy and of the previous one (rollback); drop the rest.
old_images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null |
  grep -E '^fabrium-(zooid|web):' | grep -v -E ":(${GIT_SHA}|${OLD_SHA})$" || true)"
for img in $old_images; do
  log "removing old image $img"
  docker rmi "$img" >/dev/null 2>&1 || warn "could not remove $img"
done
docker image prune -f >/dev/null 2>&1 || true
