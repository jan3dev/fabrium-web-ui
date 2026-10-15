#!/usr/bin/env bash
# Prepare an Ubuntu 24.04 VM to become an agent VM image: install Node 22, pnpm,
# opencode and Docker CE, and build the zooid CLI at --ref. It reads no bundle and
# installs no service: provision.sh adds them on each VM made from the image.
# See "Build a VM image" in deploy/README.md.
set -euo pipefail

REPO_DIR="$HOME/fabrium-web-ui"
REF=""
ZOOID_HOME="${ZOOID_HOME:-$HOME/zooid}"
REPO_URL="https://github.com/jan3dev/fabrium-web-ui.git"
INSTALL_DOCKER=1
PNPM_VERSION=12.9.1 # same as deploy/Dockerfile and provision.sh
OPENCODE_DOCKERFILE="packages/runtime-docker/docker/agent-opencode/Dockerfile"

usage() {
  cat <<USAGE
Usage: prepare-image.sh --ref <commit|branch> [--repo-dir DIR] [--repo-url URL] [--no-docker]

Prepares this VM to become an agent VM image. Installs Node 22, pnpm, opencode
(the version that the agent-opencode image pins) and Docker CE, enables linger,
and builds the zooid CLI at --ref. Reads no bundle and installs no service: run
provision.sh with the bundle on each VM made from the image. Ubuntu only. Needs sudo.

  --ref REF          commit or branch to build (required); use the commit of the central instance
  --repo-dir DIR     repo clone path       (default: \$HOME/fabrium-web-ui)
  --repo-url URL     git remote            (default: $REPO_URL)
  --no-docker        do not install Docker CE (agents cannot start containers)
  -h, --help         show this help
USAGE
}

log() { printf '[prepare-image] %s\n' "$*"; }
warn() { printf '[prepare-image] WARN: %s\n' "$*" >&2; }
die() { printf '[prepare-image] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || die "--ref needs a value"; REF="$2"; shift 2 ;;
    --repo-dir) [ $# -ge 2 ] || die "--repo-dir needs a value"; REPO_DIR="$2"; shift 2 ;;
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
# Try sudo -n first: `sudo -v` prompts when another sudoers rule (%sudo on Ubuntu images) matches.
sudo -n true 2>/dev/null || sudo -v || die "sudo authentication failed."

# Every VM made from the image would act as this VM.
[ ! -e "$ZOOID_HOME" ] || die "$ZOOID_HOME exists: an image must not hold a bundle or agent data. Use a fresh VM."
[ ! -e "$HOME/.config/systemd/user/fabrium-agent.service" ] || die "this VM runs fabrium-agent. Use a fresh VM."

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
  fi
fi

# --- systemd user instance ------------------------------------------------
# Linger starts the user's systemd instance at boot, without a login session.
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "$XDG_RUNTIME_DIR/bus" ] && break
  sleep 1
done

# The agent starts `node` and `opencode` from the service PATH, where /usr/local/bin comes
# before /usr/bin: another Node there would run the agent.
SERVICE_PATH="$(systemctl --user show-environment | sed -n 's/^PATH=//p')"
[ -n "$SERVICE_PATH" ] || die "cannot read PATH from the systemd user instance"
for path in "$PATH" "$SERVICE_PATH"; do
  PATH="$path" node -v 2>/dev/null | grep -q '^v22\.' ||
    die "the first node in PATH=$path is not v22; remove the other Node: $(PATH="$path" which -a node | tr '\n' ' ')"
done
[ "$(pnpm -v 2>/dev/null || true)" = "$PNPM_VERSION" ] ||
  die "the first pnpm in PATH is not $PNPM_VERSION: $(which -a pnpm | tr '\n' ' ')"

# --- Repo at --ref --------------------------------------------------------
if [ ! -d "$REPO_DIR/.git" ]; then
  log "Cloning repo into $REPO_DIR"
  git clone --quiet "$REPO_URL" "$REPO_DIR"
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
git -C "$REPO_DIR" checkout --quiet --detach "$COMMIT"
SHA="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD)"
log "Repo at $SHA"

# --- Build the CLI (not the web UI) ----------------------------------------
# The build reads no bundle: the VM tokens and settings come later, at run time.
log "Installing dependencies and building the zooid CLI"
(
  cd "$REPO_DIR"
  CI=true pnpm install --frozen-lockfile
  pnpm --filter 'zooid...' --filter '!@fabrium/web' build
)
[ -f "$REPO_DIR/packages/cli/dist/bin.js" ] || die "build did not produce packages/cli/dist/bin.js"
# provision.sh skips the build when --ref is this commit. Write it last: the build cleans dist/.
printf '%s\n' "$COMMIT" >"$REPO_DIR/packages/cli/dist/.commit"

# --- opencode -------------------------------------------------------------
# The opencode preset starts `opencode` from the service PATH. Same version as the agent-opencode image.
OPENCODE_VERSION="$(sed -n 's/^ARG OPENCODE_VERSION=//p' "$REPO_DIR/$OPENCODE_DOCKERFILE")"
[ -n "$OPENCODE_VERSION" ] || die "no OPENCODE_VERSION pin in $OPENCODE_DOCKERFILE"
if [ "$(PATH="$SERVICE_PATH" opencode --version 2>/dev/null || true)" = "$OPENCODE_VERSION" ]; then
  log "opencode $OPENCODE_VERSION already installed; skipping"
else
  log "Installing opencode $OPENCODE_VERSION"
  sudo npm install -g "opencode-ai@$OPENCODE_VERSION"
  [ "$(PATH="$SERVICE_PATH" opencode --version 2>/dev/null || true)" = "$OPENCODE_VERSION" ] ||
    die "opencode $OPENCODE_VERSION is not the first opencode in the service PATH ($SERVICE_PATH)"
fi

cat <<EOF_NEXT

IMAGE READY: Node $(node -v), pnpm $PNPM_VERSION, opencode $OPENCODE_VERSION, the CLI built at $SHA.

NEXT STEPS
  1. Check for credentials, clean this VM and stop it: see "Build a VM image" in deploy/README.md.
  2. Create the image from the stopped VM, with the commit in its name.
  3. On each VM made from the image, copy the bundle, then run
     bash $REPO_DIR/deploy/agent-vm/provision.sh --ref <the commit of the central instance>
EOF_NEXT
