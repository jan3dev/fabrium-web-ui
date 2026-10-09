#!/usr/bin/env bash
# Prepare a fresh Ubuntu 24.04 box (Lightsail) to run the fabrium stack. Idempotent.
set -euo pipefail

REPO_DIR="$HOME/fabrium-web-ui"
BRANCH="feat/deploy"
ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
REPO_URL="https://github.com/jan3dev/fabrium-web-ui.git"

usage() {
  cat <<USAGE
Usage: provision.sh [--repo-dir DIR] [--branch B] [--zooid-home DIR] [--repo-url URL]

Installs Docker CE + compose plugin, clones the repo, creates the ZOOID_HOME
layout, and generates .env and zooid.yaml when missing. Ubuntu only. Needs sudo.

  --repo-dir DIR     repo clone path       (default: \$HOME/fabrium-web-ui)
  --branch B         branch to check out   (default: feat/deploy)
  --zooid-home DIR   instance data dir     (default: \$HOME/zooid)
  --repo-url URL     git remote            (default: $REPO_URL)
  -h, --help         show this help
USAGE
}

log() { printf '[provision] %s\n' "$*"; }
warn() { printf '[provision] WARN: %s\n' "$*" >&2; }
die() { printf '[provision] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) [ $# -ge 2 ] || die "--repo-dir needs a value"; REPO_DIR="$2"; shift 2 ;;
    --branch) [ $# -ge 2 ] || die "--branch needs a value"; BRANCH="$2"; shift 2 ;;
    --zooid-home) [ $# -ge 2 ] || die "--zooid-home needs a value"; ZOOID_HOME="$2"; shift 2 ;;
    --repo-url) [ $# -ge 2 ] || die "--repo-url needs a value"; REPO_URL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

# --- OS and sudo checks -------------------------------------------------
[ -r /etc/os-release ] || die "/etc/os-release not found. This script supports Ubuntu only."
OS_ID="$(. /etc/os-release && echo "${ID:-}")"
OS_VERSION="$(. /etc/os-release && echo "${VERSION_ID:-}")"
[ "$OS_ID" = "ubuntu" ] || die "unsupported OS '$OS_ID'. This script supports Ubuntu only."
[ "$OS_VERSION" = "24.04" ] || warn "Ubuntu $OS_VERSION found; 24.04 is the tested version."
command -v sudo >/dev/null 2>&1 || die "sudo is required."
sudo -v || die "sudo authentication failed."

# --- Base packages ------------------------------------------------------
log "Installing base packages"
sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get update
sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y ca-certificates curl git gnupg openssl

# --- Docker CE ----------------------------------------------------------
if docker compose version >/dev/null 2>&1 || sudo docker compose version >/dev/null 2>&1; then
  log "Docker with compose plugin already installed; skipping"
else
  log "Installing Docker CE from the official apt repository"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get update
  sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! id -nG "$(id -un)" | tr ' ' '\n' | grep -qx docker; then
  log "Adding $(id -un) to the docker group (log out and in to apply)"
  sudo usermod -aG docker "$(id -un)"
fi
sudo systemctl enable --now docker

# --- Repo ---------------------------------------------------------------
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning repo into $REPO_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  log "Repo exists; fetching and checking out $BRANCH"
  git -C "$REPO_DIR" fetch --prune
  git -C "$REPO_DIR" checkout "$BRANCH"
fi

# --- ZOOID_HOME layout --------------------------------------------------
log "Creating layout in $ZOOID_HOME"
for d in workforce/agents workforce/data home data/matrix/db data/matrix/media \
         data/matrix/config/registrations web app backups; do
  mkdir -p "$ZOOID_HOME/$d"
done

ENV_FILE="$ZOOID_HOME/.env"
if [ ! -f "$ENV_FILE" ]; then
  [ -f "$REPO_DIR/deploy/.env.example" ] || die "$REPO_DIR/deploy/.env.example not found on branch $BRANCH."
  log "Creating $ENV_FILE with generated tokens"
  AS_TOKEN="$(openssl rand -hex 32)"
  HS_TOKEN="$(openssl rand -hex 32)"
  umask 077
  awk -v as="$AS_TOKEN" -v hs="$HS_TOKEN" '
    /^MATRIX_AS_TOKEN=/ { print "MATRIX_AS_TOKEN=" as; next }
    /^MATRIX_HS_TOKEN=/ { print "MATRIX_HS_TOKEN=" hs; next }
    { print }
  ' "$REPO_DIR/deploy/.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if grep -q '<run: openssl rand -hex 32>' "$ENV_FILE"; then
    warn "a token placeholder is still present in $ENV_FILE; fix it by hand"
  fi
else
  log "$ENV_FILE exists; not touched"
fi

YAML_FILE="$ZOOID_HOME/workforce/zooid.yaml"
if [ ! -f "$YAML_FILE" ]; then
  [ -f "$REPO_DIR/deploy/templates/zooid.yaml.example" ] || die "$REPO_DIR/deploy/templates/zooid.yaml.example not found."
  log "Creating $YAML_FILE from the example"
  cp "$REPO_DIR/deploy/templates/zooid.yaml.example" "$YAML_FILE"
else
  log "$YAML_FILE exists; not touched"
fi

cat <<NEXT

NEXT STEPS
  1. Edit $ENV_FILE: SERVER_NAME, SITE_ADDRESS, HOMESERVER_URL and the agent secrets.
  2. Edit $YAML_FILE for your agents.
  3. Put agent auth under $ZOOID_HOME/home/
     (for example .config/opencode and .local/share/opencode).
  4. Open ports 80 and 443 in the Lightsail firewall. Point DNS at the box.
  5. Log out and in again so the docker group applies.
  6. Run: $REPO_DIR/deploy/deploy.sh
NEXT
