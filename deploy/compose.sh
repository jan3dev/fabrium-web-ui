#!/usr/bin/env bash
# docker compose for this instance, with the same project, env file and
# variables deploy.sh uses. Example: deploy/compose.sh logs -f zooid
# Use deploy.sh to start or update the stack; a manual `up` here would run
# with default values for GIT_SHA, DAEMON_UID and DOCKER_GID.
set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[ -f "$ZOOID_HOME/.env" ] && load_env "$ZOOID_HOME/.env"
export SITE_ADDRESS="${SITE_ADDRESS:-:80}"
compose "$@"
