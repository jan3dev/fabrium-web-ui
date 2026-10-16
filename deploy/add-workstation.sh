#!/usr/bin/env bash
# Admit one agent VM (a zooid workstation in client mode) to this instance.
# Run it on the central box. See "Agent VM (workstation)" in deploy/README.md.
set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

usage() {
  cat <<'USAGE'
Usage: deploy/add-workstation.sh <workstation> --agent <name> --room <alias> [--room <alias>]...
                                 [--persona <text>] [--project <text>] [--preset <name>] [-h]

Admits one agent VM. Idempotent: run it again to update the roster entry.

  1. Writes the VM bundle ZOOID_HOME/workstations/<workstation>/: .env with new
     Matrix tokens, and workforce/zooid.yaml. Existing files are kept. Stops when
     the registration exists without the bundle .env, or when --agent is not the
     agent of the bundle.
  2. Writes the tuwunel registration. Restarts tuwunel when the registration
     changed or is not loaded, then checks the VM token and the central token.
     If a step fails, puts the previous registration back and restarts again.
  3. Adds @<workstation> to the workforce space, and @<workstation>.<name> to the
     space and the rooms, at power level 0. Publishes the agent's roster entry
     with the central token. The VM cannot change the roster or the space.

  <workstation>    [a-z0-9-]; the agent's ID is @<workstation>.<name>:SERVER_NAME
  --agent NAME     agent name, [a-z0-9-], starts with a letter, at most 32 characters
  --room ALIAS     a room that exists, for example '#zooid'; repeat for more rooms
  --persona TEXT   roster persona (UI label: Persona · Project)
  --project TEXT   roster project
  --preset NAME    ACP preset written to a new zooid.yaml (default: claude).
                   'echo' is for tests: the repo's echo fixture, no model
  -h, --help       show this help

Never prints secret values.
USAGE
}

WS="" AGENT="" PERSONA="" PROJECT="" PRESET="claude"
ROOMS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) [ $# -ge 2 ] || die "--agent needs a value"; AGENT="$2"; shift 2 ;;
    --room) [ $# -ge 2 ] || die "--room needs a value"; ROOMS+=("$2"); shift 2 ;;
    --persona) [ $# -ge 2 ] || die "--persona needs a value"; PERSONA="$2"; shift 2 ;;
    --project) [ $# -ge 2 ] || die "--project needs a value"; PROJECT="$2"; shift 2 ;;
    --preset) [ $# -ge 2 ] || die "--preset needs a value"; PRESET="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; die "unknown option: $1" ;;
    *) [ -z "$WS" ] || die "unexpected argument: $1"; WS="$1"; shift ;;
  esac
done

# --- 1. checks -------------------------------------------------------------
# Whole-string checks with letter lists: grep is line-based, and bash 3.2 [a-z] can match B or é in UTF-8.
LOWER=abcdefghijklmnopqrstuvwxyz
DIGITS=0123456789
case "$WS" in
  '' | *[!"$LOWER$DIGITS"-]*) usage >&2; die "workstation must match [a-z0-9-]+" ;;
esac
[ "$WS" != "zooid" ] || die "'zooid' is the name of the central registration"
# Same rule as zooid for agent names (packages/core/src/config.ts).
case "$AGENT" in
  '' | [!"$LOWER"]* | *[!"$LOWER$DIGITS"-]*) die "--agent must match [a-z][a-z0-9-]*" ;;
esac
[ "${#AGENT}" -le 32 ] || die "--agent must have at most 32 characters"
case "$PRESET" in
  '' | *[!"$LOWER$DIGITS"-]*) die "--preset must match [a-z0-9-]+" ;;
esac
[ "${#ROOMS[@]}" -gt 0 ] || die "give at least one --room"
for r in "${ROOMS[@]}"; do
  case "$r" in
    [#!]?*) ;;
    *) die "--room must be '#alias' or '!id' (got $r)" ;;
  esac
  case "$r" in
    *[[:space:]\'\",\\]*) die "--room must not contain spaces, quotes, commas or backslashes (got $r)" ;;
  esac
done

require_cmd docker curl jq openssl perl
ENV_FILE="$ZOOID_HOME/.env"
if [ -f "$ENV_FILE" ]; then
  load_env "$ENV_FILE"
else
  warn "no $ENV_FILE; using variables from the current environment"
fi
require_env SERVER_NAME HOMESERVER_URL MATRIX_AS_TOKEN
WORKFORCE_SPACE="${WORKFORCE_SPACE:-dev}"
# zooid.yaml has the space name in single quotes, and the space alias adds ':'.
case "$WORKFORCE_SPACE" in
  *[\'[:space:]:]*) die "WORKFORCE_SPACE must not contain quotes, spaces or ':'" ;;
esac
HS="http://${TUWUNEL_BIND:-127.0.0.1:8448}"
CENTRAL_TOKEN="$MATRIX_AS_TOKEN"
REG_DIR="$ZOOID_HOME/data/matrix/config/registrations"
[ -d "$REG_DIR" ] || die "$REG_DIR not found; run deploy.sh first"

SENDER="@$WS:$SERVER_NAME"
AGENT_ID="@$WS.$AGENT:$SERVER_NAME"
SPACE_ALIAS="#$WORKFORCE_SPACE:$SERVER_NAME"

# Room aliases without a server part get SERVER_NAME, as zooid.yaml does.
ROOM_ALIASES=()
for r in "${ROOMS[@]}"; do
  case "$r" in
    *:*) ROOM_ALIASES+=("$r") ;;
    *) ROOM_ALIASES+=("$r:$SERVER_NAME") ;;
  esac
done

# --- 2. Matrix helpers -----------------------------------------------------
# mx <METHOD> <path> <token> [json]: call tuwunel and set MX_CODE and MX_BODY.
# The token goes to curl through its config on stdin, not on the command line.
mx() {
  local method="$1" path="$2" token="$3" data="${4:-}" out
  out="$(mktemp)"
  if [ -n "$data" ]; then
    MX_CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$token" |
      curl -s -K - -X "$method" -H 'Content-Type: application/json' --data-binary "$data" \
        -o "$out" -w '%{http_code}' --max-time 30 "$HS$path")" || MX_CODE=000
  else
    MX_CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$token" |
      curl -s -K - -X "$method" -o "$out" -w '%{http_code}' --max-time 30 "$HS$path")" || MX_CODE=000
  fi
  MX_BODY="$(cat "$out")"
  rm -f "$out"
}
mx_err() { printf '%s' "$MX_BODY" | jq -r '.errcode // empty' 2>/dev/null || true; }
mx_die() { die "$1: HTTP $MX_CODE $(mx_err)"; }
uri() { jq -rn --arg s "$1" '$s|@uri'; }

# membership <room_id> <user_id>: join, invite, leave, ban, or empty when the
# central sender cannot read the room.
membership() {
  mx GET "/_matrix/client/v3/rooms/$(uri "$1")/state/m.room.member/$(uri "$2")" "$CENTRAL_TOKEN"
  if [ "$MX_CODE" = 200 ]; then
    printf '%s' "$MX_BODY" | jq -r '.membership // empty'
  fi
}

# ensure_member <room_id> <user_id> <label>: invite with the central token when
# needed, then join with the VM token as that user.
ensure_member() {
  local room="$1" user="$2" label="$3" m
  m="$(membership "$room" "$user")"
  case "$m" in
    join) return 0 ;;
    ban) die "$user is banned from $label" ;;
    invite) ;;
    *)
      mx POST "/_matrix/client/v3/rooms/$(uri "$room")/invite" "$CENTRAL_TOKEN" \
        "$(jq -cn --arg u "$user" '{user_id: $u}')"
      # A failed invite is fine for a restricted room: space members can join it.
      if [ "$MX_CODE" = 200 ]; then log "invited $user to $label"; fi
      ;;
  esac
  mx POST "/_matrix/client/v3/join/$(uri "$room")?user_id=$(uri "$user")" "$WS_AS_TOKEN" '{}'
  [ "$MX_CODE" = 200 ] || mx_die "$user cannot join $label (invite it by hand, then run this again)"
  log "$user joined $label"
}

# warn_power_level <room_id> <user_id> <label>: warn when the user has a power
# level above 0 in that room.
warn_power_level() {
  local pl
  mx GET "/_matrix/client/v3/rooms/$(uri "$1")/state/m.room.power_levels" "$CENTRAL_TOKEN"
  [ "$MX_CODE" = 200 ] || return 0
  pl="$(printf '%s' "$MX_BODY" | jq -r --arg u "$2" '.users[$u] // .users_default // 0')"
  case "$pl" in
    0 | -*) ;;
    *) warn "$2 has power level $pl in $3; expected 0 (it can change the state of $3)" ;;
  esac
}

# whoami_is <token> <user_id>: tuwunel accepts the token as that user. On a
# failure, WHOAMI_ERR says what tuwunel answered.
whoami_is() {
  local got err
  mx GET /_matrix/client/v3/account/whoami "$1"
  got="$(printf '%s' "$MX_BODY" | jq -r '.user_id // empty' 2>/dev/null || true)"
  err="$(mx_err)"
  WHOAMI_ERR="HTTP $MX_CODE${err:+ $err}, user_id '$got', expected '$2'"
  [ "$MX_CODE" = 200 ] && [ "$got" = "$2" ]
}

# vm_token_works: tuwunel knows the VM token (its registration is loaded).
vm_token_works() { whoami_is "$WS_AS_TOKEN" "$SENDER"; }

# central_token_works: the central registration is still loaded. Tuwunel keeps
# serving when a registration file is bad, but it can drop other registrations.
central_token_works() { whoami_is "$CENTRAL_TOKEN" "@zooid:$SERVER_NAME"; }

# restart_tuwunel: returns 1 when compose fails or tuwunel does not answer.
restart_tuwunel() {
  log "restarting tuwunel"
  "$REPO_DIR/deploy/compose.sh" restart tuwunel >/dev/null ||
    { warn "deploy/compose.sh restart tuwunel failed (on podman, DOCKER_HOST must be set)"; return 1; }
  wait_http "$HS/_matrix/client/versions" 120 '^2' ||
    { warn "tuwunel did not answer within 120 s"; return 1; }
}

# --- 3. VM bundle ----------------------------------------------------------
BUNDLE="$ZOOID_HOME/workstations/$WS"
WS_ENV="$BUNDLE/.env"
WS_YAML="$BUNDLE/workforce/zooid.yaml"
REG="$REG_DIR/$WS.yaml"
# 1 when this run writes a bundle file that the VM does not have yet.
BUNDLE_NEW=0

# New tokens would replace the registration and cut off the running VM.
if [ ! -f "$WS_ENV" ] && [ -f "$REG" ]; then
  die "$REG exists but $WS_ENV does not. Restore workstations/$WS/ from a backup or from the VM (~/zooid/.env and ~/zooid/workforce/zooid.yaml), or remove $REG to make new tokens (this cuts off the running VM)"
fi
mkdir -p "$BUNDLE/workforce"
chmod 700 "$ZOOID_HOME/workstations" "$BUNDLE"

if [ -f "$WS_ENV" ]; then
  log "$WS_ENV exists; reusing its tokens"
  WS_AS_TOKEN="$(sed -n 's/^MATRIX_AS_TOKEN=//p' "$WS_ENV" | tail -n 1)"
  WS_HS_TOKEN="$(sed -n 's/^MATRIX_HS_TOKEN=//p' "$WS_ENV" | tail -n 1)"
  if [ -z "$WS_AS_TOKEN" ] || [ -z "$WS_HS_TOKEN" ]; then die "$WS_ENV has no Matrix tokens"; fi
  # One VM runs one agent: another name would drop the running agent from the roster.
  BUNDLE_AGENT="$(sed -n 's/^AGENT_NAME=//p' "$WS_ENV" | tail -n 1)"
  [ -n "$BUNDLE_AGENT" ] || die "$WS_ENV has no AGENT_NAME"
  [ "$BUNDLE_AGENT" = "$AGENT" ] ||
    die "$WS_ENV is for agent '$BUNDLE_AGENT', not '$AGENT'. Use --agent $BUNDLE_AGENT, or remove the VM first (deploy/README.md, Remove a VM)"
else
  log "writing $WS_ENV with new tokens"
  BUNDLE_NEW=1
  WS_AS_TOKEN="$(openssl rand -hex 32)"
  WS_HS_TOKEN="$(openssl rand -hex 32)"
  (
    umask 077
    cat >"$WS_ENV" <<EOF_ENV
# Agent VM environment for workstation $WS. Written by deploy/add-workstation.sh.
# Copy to the VM as ~/zooid/.env (mode 600). Format rules: deploy/README.md.
WORKSTATION=$WS
AGENT_NAME=$AGENT
SERVER_NAME=$SERVER_NAME
HOMESERVER_URL=$HOMESERVER_URL
WORKFORCE_SPACE=$WORKFORCE_SPACE
MATRIX_AS_TOKEN=$WS_AS_TOKEN
MATRIX_HS_TOKEN=$WS_HS_TOKEN

# Agent secrets go in ~/zooid/secrets.env on the VM, not here: a new copy of
# the bundle replaces this file.
EOF_ENV
  )
fi
chmod 600 "$WS_ENV"
[ "$WS_AS_TOKEN" != "$CENTRAL_TOKEN" ] || die "the VM token in $WS_ENV equals the central token"

if [ -f "$WS_YAML" ]; then
  log "$WS_YAML exists; not touched (its rooms must equal the --room values)"
else
  log "writing $WS_YAML"
  BUNDLE_NEW=1
  export WORKSTATION="$WS" AGENT_NAME="$AGENT"
  if [ "$PRESET" = echo ]; then
    # Echo fixture; needs the repo clone that prepare-image.sh makes at its default --repo-dir.
    AGENT_ACP="{ command: sh, args: ['-c', 'exec node \"\$HOME/fabrium-web-ui/packages/acp-client/test/fixtures/echo-agent.ts\"'] }"
  else
    # shellcheck disable=SC2089
    AGENT_ACP="{ preset: '$PRESET' }"
  fi
  # shellcheck disable=SC2090
  export AGENT_ACP
  AGENT_ROOMS=""
  # The quotes are YAML text for the rooms list, not shell quoting.
  for a in "${ROOM_ALIASES[@]}"; do
    # shellcheck disable=SC2089
    AGENT_ROOMS="${AGENT_ROOMS:+$AGENT_ROOMS, }'$a'"
  done
  # shellcheck disable=SC2090
  export AGENT_ROOMS
  render_template "$REPO_DIR/deploy/agent-vm/zooid.yaml.example" "$WS_YAML" \
    WORKSTATION SERVER_NAME WORKFORCE_SPACE AGENT_NAME AGENT_ACP AGENT_ROOMS
fi

# --- 4. registration -------------------------------------------------------
NEXT="$BUNDLE/registration.next"
# The registration tuwunel ran with before a change; it exists only until the change loads.
PREV="$BUNDLE/registration.prev"
export WORKSTATION="$WS" WS_AS_TOKEN WS_HS_TOKEN
# The registration namespaces are regexes: escape the dots of the server name.
SERVER_NAME_RE="$(printf '%s' "$SERVER_NAME" | sed 's/\./\\./g')"
export SERVER_NAME_RE
render_template -m 600 "$REPO_DIR/deploy/templates/registration-workstation.yaml" "$NEXT" \
  WORKSTATION WS_AS_TOKEN WS_HS_TOKEN SERVER_NAME_RE

# load_registration: restart tuwunel to read $REG, check both tokens; on failure restore $PREV (or
# remove $REG), restart again and die naming the step. Call it as a plain statement: in a
# condition, set -e ignores a failed mv or rm.
load_registration() {
  local step
  if ! restart_tuwunel; then
    step="restart of tuwunel"
  elif ! vm_token_works; then
    step="VM token check ($WHOAMI_ERR)"
  elif ! central_token_works; then
    step="central token check ($WHOAMI_ERR)"
  else
    rm -f "$PREV"
    log "registration $REG loaded"
    return 0
  fi
  if [ -f "$PREV" ]; then
    warn "$step failed; putting back the previous registration"
    mv "$PREV" "$REG"
  else
    warn "$step failed; removing $REG"
    rm -f "$REG"
  fi
  restart_tuwunel || warn "tuwunel is still not healthy: check deploy/compose.sh logs tuwunel"
  die "registration for $WS not loaded: $step failed"
}

if [ -f "$REG" ] && cmp -s "$NEXT" "$REG"; then
  rm -f "$NEXT"
  if [ -f "$PREV" ] || ! vm_token_works; then
    # An earlier run stopped before tuwunel loaded $REG, or its restart failed.
    warn "tuwunel has not loaded $REG; restarting it once"
    load_registration
  else
    log "registration $REG unchanged"
  fi
else
  # Every workstation needs its own tokens; printf keeps them out of grep's arguments.
  for f in "$REG_DIR"/*.yaml; do
    if [ "$f" = "$REG" ] || [ ! -f "$f" ]; then continue; fi
    if grep -qF -f <(printf '%s\n' "$WS_AS_TOKEN" "$WS_HS_TOKEN") -- "$f"; then
      rm -f "$NEXT"
      die "$f contains a token of $WS_ENV. To make new tokens, remove $WS_ENV and $REG (this cuts off the running VM)"
    fi
  done
  # Keep an older copy: after an interrupted run, it is what tuwunel last loaded.
  if [ ! -f "$PREV" ] && [ -f "$REG" ]; then cp -p "$REG" "$PREV"; fi
  mv "$NEXT" "$REG"
  load_registration
fi

# --- 5. space, rooms and roster --------------------------------------------
mx GET "/_matrix/client/v3/directory/room/$(uri "$SPACE_ALIAS")" "$CENTRAL_TOKEN"
[ "$MX_CODE" = 200 ] || mx_die "cannot resolve $SPACE_ALIAS (start the central daemon first)"
SPACE_ID="$(printf '%s' "$MX_BODY" | jq -r .room_id)"

mx POST /_matrix/client/v3/register "$WS_AS_TOKEN" \
  "$(jq -cn --arg u "$WS.$AGENT" '{type: "m.login.application_service", username: $u}')"
case "$MX_CODE:$(mx_err)" in
  200:*) log "registered $AGENT_ID" ;;
  400:M_USER_IN_USE) ;;
  *) mx_die "cannot register $AGENT_ID" ;;
esac

ensure_member "$SPACE_ID" "$SENDER" "$SPACE_ALIAS"
ensure_member "$SPACE_ID" "$AGENT_ID" "$SPACE_ALIAS"
warn_power_level "$SPACE_ID" "$SENDER" "$SPACE_ALIAS"
warn_power_level "$SPACE_ID" "$AGENT_ID" "$SPACE_ALIAS"

ROOM_IDS=()
for a in "${ROOM_ALIASES[@]}"; do
  case "$a" in
    '!'*) id="$a" ;;
    *)
      mx GET "/_matrix/client/v3/directory/room/$(uri "$a")" "$CENTRAL_TOKEN"
      [ "$MX_CODE" = 200 ] || mx_die "room $a does not exist; create it first"
      id="$(printf '%s' "$MX_BODY" | jq -r .room_id)"
      ;;
  esac
  ensure_member "$id" "$AGENT_ID" "$a"
  warn_power_level "$id" "$AGENT_ID" "$a"
  ROOM_IDS+=("$id")
done

# Same shape as buildWorkforceRoster (packages/transport-matrix/src/workforce-publisher.ts).
ROSTER="$(jq -cn --arg uid "$AGENT_ID" --arg name "$AGENT" --arg persona "$PERSONA" --arg project "$PROJECT" '
  {version: 1, agents: [
    {user_id: $uid, name: $name, rooms: $ARGS.positional}
    + (if $persona != "" then {persona: $persona} else {} end)
    + (if $project != "" then {project: $project} else {} end)
  ]}' --args "${ROOM_IDS[@]}")"
mx PUT "/_matrix/client/v3/rooms/$(uri "$SPACE_ID")/state/dev.zooid.workforce/$(uri "$WS")" \
  "$CENTRAL_TOKEN" "$ROSTER"
[ "$MX_CODE" = 200 ] || mx_die "cannot publish the roster entry"
log "published the roster entry $WS in $SPACE_ALIAS"

# --- 6. summary -------------------------------------------------------------
SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
log "workstation $WS admitted: $AGENT_ID"
if [ "$BUNDLE_NEW" -eq 1 ]; then
  COPY_STEP="Copy the bundle to the VM. It holds the VM tokens; keep it private:
       tar -C $BUNDLE -cf - .env workforce | ssh <vm> 'mkdir -p ~/zooid && tar -C ~/zooid -xf -'"
else
  COPY_STEP="The VM already has the bundle from an earlier run: nothing to copy, unless
     it was removed from the VM (then see \"Prepare the VM\" in deploy/README.md)."
fi
cat <<EOF_NEXT

NEXT STEPS
  1. $COPY_STEP
  2. On the VM (made from the agent VM image), as the user that runs the agent
     (same commit as this instance):
       bash ~/fabrium-web-ui/deploy/agent-vm/provision.sh --ref $SHA
EOF_NEXT
