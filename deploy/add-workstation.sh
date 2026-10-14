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
     Matrix tokens, and workforce/zooid.yaml. Existing files are kept.
  2. Writes the tuwunel registration and restarts tuwunel when it changed.
     If tuwunel does not come back, removes the registration and restarts again.
  3. Adds @<workstation> and @<workstation>.<name> to the workforce space and to
     the rooms, at power level 0, and publishes the agent's roster entry with the
     central token. The VM cannot change the roster or the space.

  <workstation>    [a-z0-9-]; the agent's ID is @<workstation>.<name>:SERVER_NAME
  --agent NAME     agent name, [a-z0-9_-]
  --room ALIAS     a room that exists, for example '#zooid'; repeat for more rooms
  --persona TEXT   roster persona (UI label: Persona · Project)
  --project TEXT   roster project
  --preset NAME    ACP preset written to a new zooid.yaml (default: claude)
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
printf '%s' "$WS" | grep -Eq '^[a-z0-9-]+$' || { usage >&2; die "workstation must match [a-z0-9-]+"; }
[ "$WS" != "zooid" ] || die "'zooid' is the name of the central registration"
printf '%s' "$AGENT" | grep -Eq '^[a-z0-9_-]+$' || die "--agent must match [a-z0-9_-]+"
printf '%s' "$PRESET" | grep -Eq '^[a-z0-9-]+$' || die "--preset must match [a-z0-9-]+"
[ "${#ROOMS[@]}" -gt 0 ] || die "give at least one --room"

require_cmd docker curl jq openssl perl
ENV_FILE="$ZOOID_HOME/.env"
if [ -f "$ENV_FILE" ]; then
  load_env "$ENV_FILE"
else
  warn "no $ENV_FILE; using variables from the current environment"
fi
require_env SERVER_NAME HOMESERVER_URL MATRIX_AS_TOKEN
WORKFORCE_SPACE="${WORKFORCE_SPACE:-dev}"
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
  printf '%s' "$r" | grep -Eq "^[#!][^'\"\\\\[:space:],]+$" || die "--room must be '#alias' or '!id' (got $r)"
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

# vm_token_works: tuwunel knows the VM token (its registration is loaded).
vm_token_works() {
  mx GET /_matrix/client/v3/account/whoami "$WS_AS_TOKEN"
  [ "$MX_CODE" = 200 ]
}

# central_token_works: the central registration is still loaded. Tuwunel keeps
# serving when a registration file is bad, but it can drop other registrations.
central_token_works() {
  mx GET /_matrix/client/v3/account/whoami "$CENTRAL_TOKEN"
  [ "$MX_CODE" = 200 ]
}

restart_tuwunel() {
  log "restarting tuwunel"
  "$REPO_DIR/deploy/compose.sh" restart tuwunel >/dev/null
  wait_http "$HS/_matrix/client/versions" 120 '^2'
}

# --- 3. VM bundle ----------------------------------------------------------
BUNDLE="$ZOOID_HOME/workstations/$WS"
WS_ENV="$BUNDLE/.env"
WS_YAML="$BUNDLE/workforce/zooid.yaml"
mkdir -p "$BUNDLE/workforce"
chmod 700 "$ZOOID_HOME/workstations" "$BUNDLE"

if [ -f "$WS_ENV" ]; then
  log "$WS_ENV exists; reusing its tokens"
  WS_AS_TOKEN="$(sed -n 's/^MATRIX_AS_TOKEN=//p' "$WS_ENV" | tail -n 1)"
  WS_HS_TOKEN="$(sed -n 's/^MATRIX_HS_TOKEN=//p' "$WS_ENV" | tail -n 1)"
  if [ -z "$WS_AS_TOKEN" ] || [ -z "$WS_HS_TOKEN" ]; then die "$WS_ENV has no Matrix tokens"; fi
else
  log "writing $WS_ENV with new tokens"
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

# --- Agent secrets (referenced as \${VAR} in zooid.yaml) ---
EOF_ENV
  )
fi
chmod 600 "$WS_ENV"
[ "$WS_AS_TOKEN" != "$CENTRAL_TOKEN" ] || die "the VM token in $WS_ENV equals the central token"

if [ -f "$WS_YAML" ]; then
  log "$WS_YAML exists; not touched (its rooms must equal the --room values)"
else
  log "writing $WS_YAML"
  export WORKSTATION="$WS" AGENT_NAME="$AGENT" AGENT_PRESET="$PRESET"
  AGENT_ROOMS=""
  # The quotes are YAML text for the rooms list, not shell quoting.
  for a in "${ROOM_ALIASES[@]}"; do
    # shellcheck disable=SC2089
    AGENT_ROOMS="${AGENT_ROOMS:+$AGENT_ROOMS, }'$a'"
  done
  # shellcheck disable=SC2090
  export AGENT_ROOMS
  render_template "$REPO_DIR/deploy/agent-vm/zooid.yaml.example" "$WS_YAML" \
    WORKSTATION SERVER_NAME WORKFORCE_SPACE AGENT_NAME AGENT_PRESET AGENT_ROOMS
fi

# --- 4. registration -------------------------------------------------------
REG="$REG_DIR/$WS.yaml"
NEXT="$BUNDLE/registration.next"
export WORKSTATION="$WS" WS_AS_TOKEN WS_HS_TOKEN
# The registration namespaces are regexes: escape the dots of the server name.
SERVER_NAME_RE="$(printf '%s' "$SERVER_NAME" | sed 's/\./\\./g')"
export SERVER_NAME_RE
render_template -m 600 "$REPO_DIR/deploy/templates/registration-workstation.yaml" "$NEXT" \
  WORKSTATION WS_AS_TOKEN WS_HS_TOKEN SERVER_NAME_RE

if [ -f "$REG" ] && cmp -s "$NEXT" "$REG"; then
  rm -f "$NEXT"
  log "registration $REG unchanged"
  vm_token_works || mx_die "tuwunel rejects the VM token (is $REG loaded?)"
else
  PREV="$BUNDLE/registration.prev"
  rm -f "$PREV"
  [ ! -f "$REG" ] || cp -p "$REG" "$PREV"
  mv "$NEXT" "$REG"
  if restart_tuwunel && vm_token_works && central_token_works; then
    rm -f "$PREV"
    log "registration $REG loaded"
  else
    warn "tuwunel did not accept $REG; restoring the previous state"
    if [ -f "$PREV" ]; then mv "$PREV" "$REG"; else rm -f "$REG"; fi
    restart_tuwunel || warn "tuwunel is still not healthy: check deploy/compose.sh logs tuwunel"
    die "registration for $WS rejected"
  fi
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

mx GET "/_matrix/client/v3/rooms/$(uri "$SPACE_ID")/state/m.room.power_levels" "$CENTRAL_TOKEN"
if [ "$MX_CODE" = 200 ]; then
  pl="$(printf '%s' "$MX_BODY" | jq -r --arg u "$SENDER" '.users[$u] // .users_default // 0')"
  [ "$pl" = 0 ] || warn "$SENDER has power level $pl in the space; expected 0 (it can change the roster)"
fi

# --- 6. summary -------------------------------------------------------------
SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
log "workstation $WS admitted: $AGENT_ID"
cat <<EOF_NEXT

NEXT STEPS
  1. Copy the bundle to the VM. It holds the VM tokens; keep it private:
       tar -C $BUNDLE -cf - .env workforce | ssh <vm> 'mkdir -p ~/zooid && tar -C ~/zooid -xf -'
  2. On the VM, as the user that runs the agent (same commit as this instance):
       curl -fsSL https://raw.githubusercontent.com/jan3dev/fabrium-web-ui/$SHA/deploy/agent-vm/provision.sh -o provision.sh
       bash provision.sh --ref $SHA
EOF_NEXT
