#!/usr/bin/env bash
# Start one Fabrium agent on a VM made from the agent VM image, or update it: a zooid
# workstation in client mode, run by systemd as this user. It installs nothing: the
# image has the tools and the CLI (deploy/agent-vm/prepare-image.sh). Idempotent: run it
# again with a new --ref to update. See "Agent VM (workstation)" in deploy/README.md.
set -euo pipefail

REPO_DIR="$HOME/fabrium-web-ui"
REF=""
ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
PNPM_VERSION=12.9.1 # same as deploy/Dockerfile and prepare-image.sh

usage() {
  cat <<USAGE
Usage: provision.sh --ref <commit|branch> [--repo-dir DIR] [--zooid-home DIR]

Checks out the repo at --ref, builds the zooid CLI when the image holds another
commit, and runs it as the systemd user service fabrium-agent. Needs the bundle
from deploy/add-workstation.sh in ZOOID_HOME (.env, workforce/zooid.yaml) and a VM
made from the agent VM image (or prepared with prepare-image.sh). Installs nothing.
Ubuntu only. Needs sudo. The agent runs as this user, with this user's access.
To update, run it again with a new --ref. The agent is stopped during the build.

  --ref REF          commit or branch to run (required); use the commit of the central instance
  --repo-dir DIR     repo clone path       (default: \$HOME/fabrium-web-ui)
  --zooid-home DIR   agent data dir        (default: \$HOME/zooid)
  -h, --help         show this help
USAGE
}

log() { printf '[provision] %s\n' "$*"; }
warn() { printf '[provision] WARN: %s\n' "$*" >&2; }
die() { printf '[provision] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || die "--ref needs a value"; REF="$2"; shift 2 ;;
    --repo-dir) [ $# -ge 2 ] || die "--repo-dir needs a value"; REPO_DIR="$2"; shift 2 ;;
    --zooid-home) [ $# -ge 2 ] || die "--zooid-home needs a value"; ZOOID_HOME="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done
[ -n "$REF" ] || { usage >&2; die "--ref is required"; }

# --- OS and sudo checks -------------------------------------------------
[ -r /etc/os-release ] || die "/etc/os-release not found. This script supports Ubuntu only."
OS_ID="$(. /etc/os-release && echo "${ID:-}")"
OS_VERSION="$(. /etc/os-release && echo "${VERSION_ID:-}")"
[ "$OS_ID" = "ubuntu" ] || die "unsupported OS '$OS_ID'. This script supports Ubuntu only."
[ "$OS_VERSION" = "24.04" ] || warn "Ubuntu $OS_VERSION found; 24.04 is the tested version."
command -v sudo >/dev/null 2>&1 || die "sudo is required."
# Try sudo -n first: `sudo -v` prompts when another sudoers rule (%sudo on Ubuntu images) matches.
sudo -n true 2>/dev/null || sudo -v || die "sudo authentication failed."

# --- Bundle from the central instance -------------------------------------
ENV_FILE="$ZOOID_HOME/.env"
YAML_FILE="$ZOOID_HOME/workforce/zooid.yaml"
# Agent secrets go in secrets.env, never in .env: a new bundle overwrites .env.
SECRETS_FILE="$ZOOID_HOME/secrets.env"
if [ ! -f "$ENV_FILE" ] || [ ! -f "$YAML_FILE" ]; then
  die "copy the bundle from the central instance first ($ENV_FILE and $YAML_FILE; see deploy/add-workstation.sh)"
fi
chmod 600 "$ENV_FILE"
[ -f "$SECRETS_FILE" ] || (umask 077 && : >"$SECRETS_FILE")
chmod 600 "$SECRETS_FILE"
# env_value KEY: the value the service gets. systemd reads secrets.env after
# .env, so a KEY in secrets.env wins.
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" "$SECRETS_FILE" | tail -n 1; }
AGENT_NAME="$(env_value AGENT_NAME)"
WORKSTATION="$(env_value WORKSTATION)"
SERVER_NAME="$(env_value SERVER_NAME)"
HOMESERVER_URL="$(env_value HOMESERVER_URL)"
MATRIX_AS_TOKEN="$(env_value MATRIX_AS_TOKEN)"
for key in AGENT_NAME WORKSTATION SERVER_NAME HOMESERVER_URL MATRIX_AS_TOKEN; do
  [ -n "${!key}" ] || die "$ENV_FILE has no $key"
done
RUN_DIR="$ZOOID_HOME/workforce/data/run"
[ "${#RUN_DIR}" -le 81 ] || die "run dir path is ${#RUN_DIR} chars (max 81, Unix socket limit): choose a shorter ZOOID_HOME"

# --- Tools from the image ---------------------------------------------------
for tool in curl git jq node pnpm; do
  command -v "$tool" >/dev/null 2>&1 ||
    die "$tool is missing: use the agent VM image, or run deploy/agent-vm/prepare-image.sh first"
done

# --- VM token -------------------------------------------------------------
# The zooid log cannot prove the token (deploy/README.md): check it before an update stops the agent.
log "Checking the VM token with $HOMESERVER_URL"
rc=0
WHOAMI="$(printf 'header = "Authorization: Bearer %s"\n' "$MATRIX_AS_TOKEN" |
  curl -fsS -K - --max-time 30 "${HOMESERVER_URL%/}/_matrix/client/v3/account/whoami")" || rc=$?
[ "$rc" -ne 22 ] || die "the homeserver rejects the VM token: run deploy/add-workstation.sh on the central box and copy the bundle again"
[ "$rc" -eq 0 ] || die "cannot reach $HOMESERVER_URL (curl exit $rc)"
WHOAMI_ID="$(printf '%s' "$WHOAMI" | jq -r '.user_id // empty' 2>/dev/null || true)"
[ -n "$WHOAMI_ID" ] || die "$HOMESERVER_URL gave no Matrix user ID: check HOMESERVER_URL"
[ "$WHOAMI_ID" = "@$WORKSTATION:$SERVER_NAME" ] ||
  die "the VM token is for '$WHOAMI_ID', not @$WORKSTATION:$SERVER_NAME: run deploy/add-workstation.sh on the central box and copy the bundle again"
log "The homeserver accepts the VM token as $WHOAMI_ID"

# --- systemd user instance ------------------------------------------------
# Linger starts the user's systemd instance at boot, without a login session.
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "$XDG_RUNTIME_DIR/bus" ] && break
  sleep 1
done
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/fabrium-agent.service"

# The agent starts node and opencode from the service PATH (/usr/local/bin before /usr/bin): check it too.
SERVICE_PATH="$(systemctl --user show-environment | sed -n 's/^PATH=//p')"
[ -n "$SERVICE_PATH" ] || die "cannot read PATH from the systemd user instance"
for path in "$PATH" "$SERVICE_PATH"; do
  PATH="$path" node -v 2>/dev/null | grep -q '^v22\.' ||
    die "the first node in PATH=$path is not v22; remove the other Node: $(PATH="$path" which -a node | tr '\n' ' ')"
done
[ "$(pnpm -v 2>/dev/null || true)" = "$PNPM_VERSION" ] ||
  die "the first pnpm in PATH is not $PNPM_VERSION: $(which -a pnpm | tr '\n' ' ')"

# --- Repo at --ref --------------------------------------------------------
[ -d "$REPO_DIR/.git" ] ||
  die "no repo in $REPO_DIR: use the agent VM image, or run deploy/agent-vm/prepare-image.sh first"
# The commit of the running agent: the way back if this update fails.
PREV_SHA=""
if systemctl --user is-active --quiet fabrium-agent.service 2>/dev/null; then
  PREV_SHA="$(git -C "$REPO_DIR" rev-parse -q --verify HEAD 2>/dev/null || true)"
fi
git -C "$REPO_DIR" fetch --quiet --prune origin
[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ] ||
  die "working tree in $REPO_DIR has uncommitted changes"
# The fetch above gets branch heads only; a commit no branch holds (squash-merged) needs its full SHA.
COMMIT="$(git -C "$REPO_DIR" rev-parse --verify -q "origin/$REF^{commit}" ||
  git -C "$REPO_DIR" rev-parse --verify -q "$REF^{commit}" ||
  { git -C "$REPO_DIR" fetch --quiet origin -- "$REF" &&
    git -C "$REPO_DIR" rev-parse --verify -q "FETCH_HEAD^{commit}"; })" ||
  die "unknown ref: $REF (a commit that is on no branch needs its full SHA)"

# The agent runs from this tree: stop it first; a failure leaves it stopped until the restart below.
if [ -f "$UNIT_FILE" ]; then
  log "Stopping fabrium-agent for the update"
  systemctl --user stop fabrium-agent.service
  trap 'warn "fabrium-agent is stopped. Fix the error and run this script again${PREV_SHA:+, or run it with --ref $PREV_SHA to go back}."' EXIT
fi
git -C "$REPO_DIR" checkout --quiet --detach "$COMMIT"
SHA="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
log "Repo at $SHA"

# --- Build the CLI (not the web UI) ----------------------------------------
# prepare-image.sh and this script write the commit of the last build in dist/.commit.
BUILT_FILE="$REPO_DIR/packages/cli/dist/.commit"
if [ "$(cat "$BUILT_FILE" 2>/dev/null || true)" = "$COMMIT" ] && [ -f "$REPO_DIR/packages/cli/dist/bin.js" ]; then
  log "The CLI is already built at $SHA; skipping the build"
else
  log "Installing dependencies and building the zooid CLI"
  (
    cd "$REPO_DIR"
    CI=true pnpm install --frozen-lockfile
    pnpm --filter 'zooid...' --filter '!@fabrium/web' build
  )
  [ -f "$REPO_DIR/packages/cli/dist/bin.js" ] || die "build did not produce packages/cli/dist/bin.js"
  # Last: the build cleans dist/.
  printf '%s\n' "$COMMIT" >"$BUILT_FILE"
fi

# --- Agent layout ---------------------------------------------------------
# Under runtime: local zooid does not create the agent's working directory.
mkdir -p "$ZOOID_HOME/workforce/agents/$AGENT_NAME" "$ZOOID_HOME/workforce/data"

# --- systemd user service -------------------------------------------------
log "Installing the fabrium-agent user service"
mkdir -p "$UNIT_DIR"
NODE_BIN="$(command -v node)"
sed -e "s|\${ZOOID_HOME}|$ZOOID_HOME|g" -e "s|\${REPO_DIR}|$REPO_DIR|g" -e "s|\${NODE_BIN}|$NODE_BIN|g" \
  "$REPO_DIR/deploy/agent-vm/fabrium-agent.service" >"$UNIT_FILE"
systemctl --user daemon-reload
systemctl --user enable fabrium-agent.service >/dev/null 2>&1
STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl --user restart fabrium-agent.service
# systemd runs the new commit now, or restarts it in a loop: the agent is not stopped.
trap - EXIT

# The token check above proves the bundle; this wait only shows the sync loop started.
log "Waiting for fabrium-agent to start its sync loop (up to 120 s)"
ok=0
for _ in $(seq 1 60); do
  # Not grep -q: with pipefail, journalctl can fail with SIGPIPE when grep exits early.
  if journalctl --user -u fabrium-agent.service --since "$STARTED_AT" --no-pager 2>/dev/null |
    grep -F 'sync loop(s) running' >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  journalctl --user -u fabrium-agent.service --since "$STARTED_AT" --no-pager -n 40 || true
  die "fabrium-agent did not start its sync loop; see journalctl --user -u fabrium-agent${PREV_SHA:+. To go back, run this script again with --ref $PREV_SHA}"
fi
log "fabrium-agent started its sync loop at $SHA"

cat <<EOF_NEXT

NEXT STEPS
  1. Give the agent its credentials as this user (for example ~/.claude or
     ~/.config/opencode) and its secrets in $SECRETS_FILE, one KEY=value
     per line. Not in $ENV_FILE: a new bundle overwrites it.
     Then: systemctl --user restart fabrium-agent
  2. Put the agent's instructions (AGENTS.md, skills) in $ZOOID_HOME/workforce/agents/$AGENT_NAME.
  3. Logs: journalctl --user -u fabrium-agent -f
  4. Update: run this script again with --ref <the commit of the central instance>.
EOF_NEXT
