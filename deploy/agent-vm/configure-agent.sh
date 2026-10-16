#!/usr/bin/env bash
# Configure the opencode agent of this VM from variables: Haven inference and GitHub access,
# checked with one real turn, then restart fabrium-agent. Self-contained: it can run from a
# download. Run it after provision.sh, and again after a variable changes.
# See "Configure an opencode agent" in deploy/README.md.
set -euo pipefail

ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
HAVEN_PRICING_URL="https://ankara.aquabtc.com/api/v1/haven/pricing/"
HAVEN_PROVIDER_NPM="github:jan3dev/haven-proxy#semver:0.x"
TEST_TIMEOUT_SEC=300 # the first turn installs the provider package
VARS="HAVEN_API_KEY HAVEN_MODEL GH_TOKEN GIT_USER_NAME GIT_USER_EMAIL"

usage() {
  cat <<USAGE
Usage: configure-agent.sh [-h]

Configures the opencode agent of this VM and restarts fabrium-agent. Run it as the
user that runs the agent, after provision.sh. Idempotent: run it again after a
variable changes.

Takes each variable from the environment, or from \$ZOOID_HOME/secrets.env when the
environment does not set it, and stores it in secrets.env: the service reads only
that file.

  HAVEN_API_KEY    required; the Haven API key (hvn1_...)
  HAVEN_MODEL      required; a Haven model with tool calling, for example glm-5-3
  GH_TOKEN         optional; a GitHub token for git and gh
  GIT_USER_NAME    optional; git author name  (default: from the GH_TOKEN account)
  GIT_USER_EMAIL   optional; git author email (default: that account's noreply address)

Then it writes opencode.json in the agent's working directory, runs one opencode
turn with the service's binary and environment, configures git for GitHub, and
restarts fabrium-agent. ZOOID_HOME defaults to \$HOME/zooid.
Never prints secret values.

  -h, --help       show this help
USAGE
}

log() { printf '[configure-agent] %s\n' "$*"; }
warn() { printf '[configure-agent] WARN: %s\n' "$*" >&2; }
die() { printf '[configure-agent] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" -ne 0 ] || die "run this script as the user that runs the agent, not as root"
for tool in curl git jq systemctl systemd-run journalctl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is missing: use the agent VM image"
done

TMP_FILES=()
cleanup() { [ "${#TMP_FILES[@]}" -eq 0 ] || rm -f "${TMP_FILES[@]}"; }
trap cleanup EXIT

# file_value FILE KEY: the last KEY= value in FILE, without the quotes that systemd removes.
file_value() {
  [ -f "$1" ] || return 0
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -n 1 |
    sed -e 's/[[:space:]]*$//' -e "s/^\([\"']\)\(.*\)\1\$/\2/"
}

# --- Bundle and service -----------------------------------------------------
ENV_FILE="$ZOOID_HOME/.env"
YAML_FILE="$ZOOID_HOME/workforce/zooid.yaml"
SECRETS_FILE="$ZOOID_HOME/secrets.env"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found: copy the bundle from the central instance first"
[ -f "$YAML_FILE" ] || die "$YAML_FILE not found: copy the bundle from the central instance first"
[ -f "$HOME/.config/systemd/user/fabrium-agent.service" ] ||
  die "fabrium-agent is not installed: run deploy/agent-vm/provision.sh first"
AGENT_NAME="$(file_value "$ENV_FILE" AGENT_NAME)"
WORKSTATION="$(file_value "$ENV_FILE" WORKSTATION)"
SERVER_NAME="$(file_value "$ENV_FILE" SERVER_NAME)"
for key in AGENT_NAME WORKSTATION SERVER_NAME; do
  [ -n "${!key}" ] || die "$ENV_FILE has no $key: copy the bundle again"
done
AGENT_ID="@$WORKSTATION.$AGENT_NAME:$SERVER_NAME"
AGENT_DIR="$ZOOID_HOME/workforce/agents/$AGENT_NAME"
[ -d "$AGENT_DIR" ] || die "$AGENT_DIR not found: run deploy/agent-vm/provision.sh first"

# The central box chooses the harness: add-workstation.sh --preset writes it into the bundle.
grep -Eq '^runtime: *local' "$YAML_FILE" ||
  die "$YAML_FILE does not use runtime: local; this script configures the opencode of this VM"
if ! grep -Eq "preset: *[\"']?opencode[\"']?" "$YAML_FILE"; then
  ROOM_ARGS="$(sed -n '/rooms: *\[/{s/.*rooms: *\[\([^]]*\)\].*/\1/;s/, */ --room /g;p;q;}' "$YAML_FILE" || true)"
  die "the bundle does not use preset opencode. On the central box, run:
    rm ~/zooid/workstations/$WORKSTATION/workforce/zooid.yaml
    deploy/add-workstation.sh $WORKSTATION --agent $AGENT_NAME --room ${ROOM_ARGS:-<alias>} --persona <persona> --project <project> --preset opencode
  Give the persona and the project again: add-workstation.sh publishes the roster entry from its arguments.
  Then copy the bundle to this VM again and run this script again."
fi

# --- Variables ----------------------------------------------------------------
# The environment wins; secrets.env fills the gaps.
HAVEN_API_KEY="${HAVEN_API_KEY:-$(file_value "$SECRETS_FILE" HAVEN_API_KEY)}"
HAVEN_MODEL="${HAVEN_MODEL:-$(file_value "$SECRETS_FILE" HAVEN_MODEL)}"
GH_TOKEN="${GH_TOKEN:-$(file_value "$SECRETS_FILE" GH_TOKEN)}"
GIT_USER_NAME="${GIT_USER_NAME:-$(file_value "$SECRETS_FILE" GIT_USER_NAME)}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-$(file_value "$SECRETS_FILE" GIT_USER_EMAIL)}"
for key in $VARS; do
  case "${!key}" in
    *$'\n'* | *$'\r'* | *\\* | \"* | \'*)
      die "$key has a line break, a backslash or a leading quote: secrets.env cannot hold it as KEY=value" ;;
  esac
done

log "Reading the Haven model list"
PRICING="$(curl -fsS --max-time 30 "$HAVEN_PRICING_URL")" || die "cannot read $HAVEN_PRICING_URL"
# Skip models the list marks deprecated or without tool calling. Today it marks none: the test turn decides.
MODELS="$(jq -r '.[] | select(.status != "deprecated" and (.capabilities // {}).tool_call != false) | .id' <<<"$PRICING")" ||
  die "unexpected answer from $HAVEN_PRICING_URL"
MODEL_LIST="$(tr '\n' ' ' <<<"$MODELS")"
missing=""
for key in HAVEN_API_KEY HAVEN_MODEL; do
  [ -n "${!key}" ] || missing="$missing $key"
done
[ -z "$missing" ] ||
  die "missing:$missing. Export it (a variable set without export does not reach this script)," \
    "or add a KEY=value line to $SECRETS_FILE. Haven models now: $MODEL_LIST"
grep -Fxq -- "$HAVEN_MODEL" <<<"$MODELS" ||
  die "HAVEN_MODEL=$HAVEN_MODEL is not on the Haven model list, or the list marks it deprecated or without tool calling. Haven models now: $MODEL_LIST"
case "$HAVEN_API_KEY" in
  hvn1_*) ;;
  *) warn "HAVEN_API_KEY does not start with hvn1_: check the key" ;;
esac

# --- secrets.env -------------------------------------------------------------
# store KEY VALUE: replace the KEY lines and keep the others. printf is a builtin: the value stays out of argv.
store() {
  local tmp
  tmp="$(mktemp "$SECRETS_FILE.XXXXXX")"
  TMP_FILES+=("$tmp")
  { grep -Ev "^[[:space:]]*$1[[:space:]]*=" "$SECRETS_FILE" || [ $? -eq 1 ]; } >"$tmp"
  printf '%s=%s\n' "$1" "$2" >>"$tmp"
  mv -f "$tmp" "$SECRETS_FILE"
}
[ -f "$SECRETS_FILE" ] || (umask 077 && : >"$SECRETS_FILE")
chmod 600 "$SECRETS_FILE"
for key in $VARS; do
  if [ -n "${!key}" ] && [ "$(file_value "$SECRETS_FILE" "$key")" != "${!key}" ]; then
    store "$key" "${!key}"
    log "stored $key in $SECRETS_FILE"
  fi
done

# --- Global opencode config -----------------------------------------------------
# opencode merges it with the workdir config: a model or a haven provider there changes what the agent runs.
for f in "$HOME/.config/opencode/opencode.json" "$HOME/.config/opencode/opencode.jsonc" "$HOME/.config/opencode/config.json"; do
  [ -f "$f" ] || continue
  if ! found="$(jq -r '[(if has("model") then "model" else empty end),
      ((.provider // {}) | keys[] | select(. == "haven" or . == "haven-local") | "provider." + .)] | join(", ")' "$f" 2>/dev/null)"; then
    warn "cannot read $f as JSON: check by hand that it sets no model and no haven or haven-local provider"
    continue
  fi
  [ -z "$found" ] || die "$f sets $found: remove it; opencode merges that file into the agent's config"
done

# --- opencode.json --------------------------------------------------------------
# This script owns model and provider.haven; other keys stay. deploy/README.md explains the limits.
OPENCODE_JSON="$AGENT_DIR/opencode.json"
CURRENT='{}'
if [ -f "$OPENCODE_JSON" ]; then
  CURRENT="$(jq -c 'if type == "object" then . else error("not an object") end' "$OPENCODE_JSON" 2>/dev/null)" ||
    die "$OPENCODE_JSON is not a JSON object: fix it or remove it"
fi
NEW="$(jq --arg model "$HAVEN_MODEL" --arg npm "$HAVEN_PROVIDER_NPM" '
  .["$schema"] = "https://opencode.ai/config.json"
  | .model = "haven/" + $model
  | .provider.haven = {
      npm: $npm,
      name: "Haven",
      options: {apiKey: "{env:HAVEN_API_KEY}"},
      models: {($model): {name: ($model + " (Haven)"), tool_call: true, limit: {context: 64000, output: 16384}}}
    }
  | .permission.webfetch //= "allow"' <<<"$CURRENT")"
if [ "$(jq -cS . <<<"$NEW")" = "$(jq -cS . <<<"$CURRENT")" ]; then
  log "$OPENCODE_JSON is up to date"
else
  printf '%s\n' "$NEW" >"$OPENCODE_JSON.tmp"
  mv -f "$OPENCODE_JSON.tmp" "$OPENCODE_JSON"
  log "wrote $OPENCODE_JSON: model haven/$HAVEN_MODEL"
fi

# --- Test turn -------------------------------------------------------------------
# The service's binary by full path: systemd-run resolves a bare name with this shell's PATH.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
SERVICE_PATH="$(systemctl --user show-environment | sed -n 's/^PATH=//p')"
[ -n "$SERVICE_PATH" ] || die "cannot read PATH from the systemd user instance"
OPENCODE_BIN="$(PATH="$SERVICE_PATH"; command -v opencode || true)"
[ -n "$OPENCODE_BIN" ] || die "no opencode in the service PATH ($SERVICE_PATH): use the agent VM image"
# Only a tool call can return the content of this file.
TEST_FILE="$AGENT_DIR/.configure-agent-test"
TMP_FILES+=("$TEST_FILE")
NONCE="check-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
printf '%s\n' "$NONCE" >"$TEST_FILE"
log "Running one opencode turn on Haven with $OPENCODE_BIN (up to $TEST_TIMEOUT_SEC s: the first turn installs the provider)"
rc=0
OUT="$(systemd-run --user --quiet --wait --pipe --collect \
  --working-directory="$AGENT_DIR" \
  -p EnvironmentFile="$ENV_FILE" -p EnvironmentFile="$SECRETS_FILE" \
  -p RuntimeMaxSec="$TEST_TIMEOUT_SEC" \
  "$OPENCODE_BIN" run "Use the read tool to read the file $(basename "$TEST_FILE"), then reply with only its content." \
  </dev/null 2>&1)" || rc=$?
rm -f "$TEST_FILE"
if [ "$rc" -ne 0 ] || ! grep -Fq -- "$NONCE" <<<"$OUT"; then
  printf '%s\n' "$OUT" | tail -n 30 >&2
  die "the test turn failed (exit $rc): check HAVEN_API_KEY, the Haven balance and HAVEN_MODEL in the output above." \
    "$SECRETS_FILE already holds the new values; fabrium-agent keeps the old ones until it restarts"
fi
log "opencode answered on Haven with haven/$HAVEN_MODEL and used a tool"

# --- GitHub ----------------------------------------------------------------------
if [ -z "$GH_TOKEN" ]; then
  log "No GH_TOKEN: git has no GitHub access (the agent cannot push or open pull requests)"
else
  command -v gh >/dev/null 2>&1 || die "gh is missing: install the GitHub CLI"
  GH_USER="$(GH_TOKEN="$GH_TOKEN" gh api user 2>/dev/null)" || die "GitHub rejects GH_TOKEN"
  GH_LOGIN="$(jq -r '.login // empty' <<<"$GH_USER")"
  GH_ID="$(jq -r '.id // empty' <<<"$GH_USER")"
  if [ -z "$GH_LOGIN" ] || [ -z "$GH_ID" ]; then
    die "gh api user gave no login or id: check GH_TOKEN"
  fi
  [ -n "$GIT_USER_NAME" ] || GIT_USER_NAME="$(jq -r '.name // empty' <<<"$GH_USER")"
  [ -n "$GIT_USER_NAME" ] || GIT_USER_NAME="$GH_LOGIN"
  [ -n "$GIT_USER_EMAIL" ] || GIT_USER_EMAIL="$GH_ID+$GH_LOGIN@users.noreply.github.com"
  git config --global user.name "$GIT_USER_NAME"
  git config --global user.email "$GIT_USER_EMAIL"
  # The helper reads GH_TOKEN from the environment at each call: the token stays only in secrets.env.
  GH_TOKEN="$GH_TOKEN" gh auth setup-git --hostname github.com
  log "git commits as $GIT_USER_NAME <$GIT_USER_EMAIL> and pushes to GitHub as $GH_LOGIN"
fi

# --- Restart ---------------------------------------------------------------------
log "Restarting fabrium-agent"
STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl --user restart fabrium-agent.service
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
# A crash restarts the service with a new PID.
PID="$(systemctl --user show -p MainPID --value fabrium-agent.service)"
sleep 5
if [ "$ok" -ne 1 ] || ! systemctl --user is-active --quiet fabrium-agent.service ||
  [ "$(systemctl --user show -p MainPID --value fabrium-agent.service)" != "$PID" ]; then
  journalctl --user -u fabrium-agent.service --since "$STARTED_AT" --no-pager -n 40 || true
  die "fabrium-agent did not start cleanly; see journalctl --user -u fabrium-agent"
fi

cat <<EOF_NEXT

AGENT READY: $AGENT_ID runs opencode with haven/$HAVEN_MODEL.

NEXT STEPS
  1. Mention $AGENT_ID in one of its rooms, and approve its requests.
  2. Logs: journalctl --user -u fabrium-agent -f
  3. To change a variable, export it or edit $SECRETS_FILE, then run this script again.
EOF_NEXT
