#!/usr/bin/env bash
# Prepare an Ubuntu 24.04 VM to run one Fabrium agent, or update it: a zooid
# workstation in client mode, run by systemd as this user. Idempotent: run it
# again with a new --ref to update. See "Agent VM (workstation)" in deploy/README.md.
set -euo pipefail

REPO_DIR="$HOME/fabrium-web-ui"
REF=""
ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
REPO_URL="https://github.com/jan3dev/fabrium-web-ui.git"
INSTALL_DOCKER=1
PNPM_VERSION=12.9.1 # same as deploy/Dockerfile

usage() {
  cat <<USAGE
Usage: provision.sh --ref <commit|branch> [--repo-dir DIR] [--zooid-home DIR] [--repo-url URL] [--no-docker]

Installs Node 22, pnpm and Docker CE, checks out the repo at --ref, builds the
zooid CLI, and runs it as the systemd user service fabrium-agent. Needs the
bundle from deploy/add-workstation.sh in ZOOID_HOME (.env, workforce/zooid.yaml).
Ubuntu only. Needs sudo. The agent runs as this user, with this user's access.

  --ref REF          commit or branch to run (required); use the commit of the central instance
  --repo-dir DIR     repo clone path       (default: \$HOME/fabrium-web-ui)
  --zooid-home DIR   agent data dir        (default: \$HOME/zooid)
  --repo-url URL     git remote            (default: $REPO_URL)
  --no-docker        do not install Docker CE (the agent cannot start containers)
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
    --repo-url) [ $# -ge 2 ] || die "--repo-url needs a value"; REPO_URL="$2"; shift 2 ;;
    --no-docker) INSTALL_DOCKER=0; shift ;;
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
# `sudo -v` asks for a password even with NOPASSWD when another sudoers rule
# matches without it (the %sudo group on Ubuntu cloud images); try -n first.
sudo -n true 2>/dev/null || sudo -v || die "sudo authentication failed."

# --- Bundle from the central instance -------------------------------------
ENV_FILE="$ZOOID_HOME/.env"
YAML_FILE="$ZOOID_HOME/workforce/zooid.yaml"
if [ ! -f "$ENV_FILE" ] || [ ! -f "$YAML_FILE" ]; then
  die "copy the bundle from the central instance first ($ENV_FILE and $YAML_FILE; see deploy/add-workstation.sh)"
fi
chmod 600 "$ENV_FILE"
AGENT_NAME="$(sed -n 's/^AGENT_NAME=//p' "$ENV_FILE" | tail -n 1)"
[ -n "$AGENT_NAME" ] || die "$ENV_FILE has no AGENT_NAME"
RUN_DIR="$ZOOID_HOME/workforce/data/run"
[ "${#RUN_DIR}" -le 81 ] || die "run dir path is ${#RUN_DIR} chars (max 81, Unix socket limit): choose a shorter ZOOID_HOME"

# --- Packages -----------------------------------------------------------
APT="sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get"
log "Installing base packages"
$APT update
$APT install -y ca-certificates curl git gnupg jq
sudo install -m 0755 -d /etc/apt/keyrings

if node -v 2>/dev/null | grep -q '^v22\.'; then
  log "Node $(node -v) already installed; skipping"
else
  log "Installing Node 22 from the NodeSource apt repository"
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" |
    sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  $APT update
  $APT install -y nodejs
fi

if [ "$(pnpm -v 2>/dev/null || true)" = "$PNPM_VERSION" ]; then
  log "pnpm $PNPM_VERSION already installed; skipping"
else
  log "Installing pnpm $PNPM_VERSION"
  sudo npm install -g "pnpm@$PNPM_VERSION"
fi

GROUP_ADDED=0
if [ "$INSTALL_DOCKER" -eq 1 ]; then
  if command -v dockerd >/dev/null 2>&1; then
    log "Docker CE already installed; skipping"
  else
    log "Installing Docker CE from Docker's apt repository (for the agent's own containers)"
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
      sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    $APT update
    $APT install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # The docker group is root on this VM in practice; the agent has that access on purpose.
  if ! id -nG "$(id -un)" | tr ' ' '\n' | grep -qx docker; then
    log "Adding $(id -un) to the docker group"
    sudo usermod -aG docker "$(id -un)"
    GROUP_ADDED=1
  fi
fi

# --- Repo at --ref --------------------------------------------------------
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning repo into $REPO_DIR"
  git clone --quiet "$REPO_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" fetch --quiet --prune origin
[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ] ||
  die "working tree in $REPO_DIR has uncommitted changes"
COMMIT="$(git -C "$REPO_DIR" rev-parse --verify -q "origin/$REF^{commit}" ||
  git -C "$REPO_DIR" rev-parse --verify -q "$REF^{commit}")" || die "unknown ref: $REF"
git -C "$REPO_DIR" checkout --quiet --detach "$COMMIT"
SHA="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
log "Repo at $SHA"

# --- Build the CLI (not the web UI) ----------------------------------------
log "Installing dependencies and building the zooid CLI"
(
  cd "$REPO_DIR"
  CI=true pnpm install --frozen-lockfile
  pnpm --filter 'zooid...' --filter '!@fabrium/web' build
)
[ -f "$REPO_DIR/packages/cli/dist/bin.js" ] || die "build did not produce packages/cli/dist/bin.js"

# --- Agent layout ---------------------------------------------------------
# Under runtime: local zooid does not create the agent's working directory.
mkdir -p "$ZOOID_HOME/workforce/agents/$AGENT_NAME" "$ZOOID_HOME/workforce/data"

# --- systemd user service -------------------------------------------------
# Linger starts the user's systemd instance at boot, without a login session.
log "Installing the fabrium-agent user service"
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "$XDG_RUNTIME_DIR/bus" ] && break
  sleep 1
done
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
NODE_BIN="$(command -v node)"
sed -e "s|\${ZOOID_HOME}|$ZOOID_HOME|g" -e "s|\${REPO_DIR}|$REPO_DIR|g" -e "s|\${NODE_BIN}|$NODE_BIN|g" \
  "$REPO_DIR/deploy/agent-vm/fabrium-agent.service" >"$UNIT_DIR/fabrium-agent.service"
systemctl --user daemon-reload
systemctl --user enable fabrium-agent.service >/dev/null 2>&1
STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl --user restart fabrium-agent.service

log "Waiting for the workstation to sync (up to 120 s)"
ok=0
for _ in $(seq 1 60); do
  if journalctl --user -u fabrium-agent.service --since "$STARTED_AT" --no-pager 2>/dev/null |
    grep -q 'sync loop(s) running'; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  journalctl --user -u fabrium-agent.service --since "$STARTED_AT" --no-pager -n 40 || true
  die "fabrium-agent did not start syncing; see journalctl --user -u fabrium-agent"
fi
log "fabrium-agent is running at $SHA"

cat <<EOF_NEXT

NEXT STEPS
  1. Give the agent its credentials as this user (for example ~/.claude or
     ~/.config/opencode) and its secrets in $ENV_FILE.
     Then: systemctl --user restart fabrium-agent
  2. Put the agent's instructions (AGENTS.md, skills) in $ZOOID_HOME/workforce/agents/$AGENT_NAME.
  3. Logs: journalctl --user -u fabrium-agent -f
  4. Update: run this script again with --ref <the commit of the central instance>.
EOF_NEXT
if [ "$GROUP_ADDED" -eq 1 ]; then
  warn "$(id -un) was added to the docker group: reboot once (sudo reboot) so the agent gets it"
fi
