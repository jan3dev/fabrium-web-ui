#!/usr/bin/env bash
# Send the first message of this VM's agent to the person who created the VM, in a new direct room:
# it shows that the agent works. The VM management API of the central instance runs it once, as the
# last step of the setup, with FABRIUM_CREATOR set. The agent's own model writes the message; a fixed
# text replaces it when the model fails. Run it as the agent's user, after configure-agent.sh.
set -euo pipefail

ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
ENV_FILE="$ZOOID_HOME/.env"
SECRETS_FILE="$ZOOID_HOME/secrets.env"
GREET_TIMEOUT_SEC=180

log() { printf '[greet] %s\n' "$*"; }
die() { printf '[greet] ERROR: %s\n' "$*" >&2; exit 1; }

# file_value FILE KEY: the last KEY= value in FILE, without the quotes that systemd removes.
file_value() {
  [ -f "$1" ] || return 0
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -n 1 |
    sed -e 's/[[:space:]]*$//' -e "s/^\([\"']\)\(.*\)\1\$/\2/"
}

CREATOR="${FABRIUM_CREATOR:-}"
[[ "$CREATOR" =~ ^@[a-z0-9._=/+-]+:[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "FABRIUM_CREATOR is not a Matrix user ID"
AGENT_NAME="$(file_value "$ENV_FILE" AGENT_NAME)"
WORKSTATION="$(file_value "$ENV_FILE" WORKSTATION)"
SERVER_NAME="$(file_value "$ENV_FILE" SERVER_NAME)"
HOMESERVER_URL="$(file_value "$ENV_FILE" HOMESERVER_URL)"
MATRIX_AS_TOKEN="$(file_value "$ENV_FILE" MATRIX_AS_TOKEN)"
for key in AGENT_NAME WORKSTATION SERVER_NAME HOMESERVER_URL MATRIX_AS_TOKEN; do
  [ -n "${!key}" ] || die "$ENV_FILE has no $key"
done
AGENT_ID="@$WORKSTATION.$AGENT_NAME:$SERVER_NAME"
AGENT_DIR="$ZOOID_HOME/workforce/agents/$AGENT_NAME"
uri() { jq -rn --arg v "$1" '$v | @uri'; }

# matrix METHOD PATH [JSON]: a client API call as the agent. The token goes to curl on stdin, not in argv.
matrix() {
  local sep='?'
  [[ "$2" == *\?* ]] && sep='&'
  printf 'header = "Authorization: Bearer %s"\n' "$MATRIX_AS_TOKEN" |
    curl -fsS -K - --max-time 30 -X "$1" -H 'content-type: application/json' \
      ${3:+--data "$3"} "${HOMESERVER_URL%/}$2${sep}user_id=$(uri "$AGENT_ID")"
}

# --- The message --------------------------------------------------------------
PROMPT="You are $AGENT_NAME, an AI agent that was just born: you came online for the first time, on your own virtual machine. Say hi to your creator, $CREATOR, so that they know you work. Write two or three short sentences in English, in your own words. Tell them that they can talk to you by mentioning you ($AGENT_ID) in a room of the workspace. Reply with the message only."
TEXT=""
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
SERVICE_PATH="$(systemctl --user show-environment | sed -n 's/^PATH=//p')"
OPENCODE_BIN="$(PATH="$SERVICE_PATH"; command -v opencode || true)"
if [ -n "$OPENCODE_BIN" ] && [ -d "$AGENT_DIR" ]; then
  log "asking the agent's model for the message (up to $GREET_TIMEOUT_SEC s)"
  # Same runner as the test turn of configure-agent.sh: the agent's directory, environment and model.
  TEXT="$(systemd-run --user --quiet --wait --pipe --collect \
    --working-directory="$AGENT_DIR" \
    -p EnvironmentFile="$ENV_FILE" -p EnvironmentFile="$SECRETS_FILE" \
    -p RuntimeMaxSec="$GREET_TIMEOUT_SEC" \
    "$OPENCODE_BIN" run "$PROMPT" </dev/null 2>/dev/null)" || TEXT=""
  # Drop colors and leading blank lines. Cut after the pipe: a `head` there dies of SIGPIPE.
  TEXT="$(printf '%s' "$TEXT" | sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' | sed -e '/[^[:space:]]/,$!d')"
  TEXT="${TEXT:0:1500}"
fi
if [ -z "${TEXT//[[:space:]]/}" ]; then
  log "the model gave no message: sending the fixed text"
  TEXT="Hi! I am $AGENT_NAME, and I just came online on my own virtual machine. Everything works. Mention me ($AGENT_ID) in a room of the workspace to talk to me."
fi

# --- The direct room --------------------------------------------------------------
BODY="$(jq -cn --arg u "$CREATOR" '{preset: "trusted_private_chat", is_direct: true, invite: [$u]}')"
ROOM="$(matrix POST /_matrix/client/v3/createRoom "$BODY" | jq -r '.room_id // empty')"
[ -n "$ROOM" ] || die "the homeserver gave no room for the direct chat"
# m.direct marks the room as a direct chat for the agent; the invite carries is_direct for the creator.
DIRECT="$(matrix GET "/_matrix/client/v3/user/$(uri "$AGENT_ID")/account_data/m.direct" 2>/dev/null || printf '{}')"
DIRECT="$(jq -c --arg u "$CREATOR" --arg r "$ROOM" '.[$u] = ((.[$u] // []) + [$r] | unique)' <<<"$DIRECT")"
matrix PUT "/_matrix/client/v3/user/$(uri "$AGENT_ID")/account_data/m.direct" "$DIRECT" >/dev/null ||
  log "could not mark the room as a direct chat; the message still goes out"
MESSAGE="$(jq -cn --arg b "$TEXT" '{msgtype: "m.text", body: $b}')"
matrix PUT "/_matrix/client/v3/rooms/$(uri "$ROOM")/send/m.room.message/greet-$(date +%s)-$$" "$MESSAGE" >/dev/null
log "sent the first message to $CREATOR"
