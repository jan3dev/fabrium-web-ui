# Deploying Fabrium

Everything an instance runs comes from this repo as one Docker Compose project
(`deploy/docker-compose.yml`):

| Service | Image | Role |
|---|---|---|
| `tuwunel` | `ghcr.io/matrix-construct/tuwunel` pinned by digest | Matrix homeserver (chats, accounts, rooms). |
| `zooid` | `fabrium-zooid:<git sha>`, built from `deploy/Dockerfile` | The daemon (`zooid start`). Starts one container per agent through the engine socket (podman's Docker-compatible socket on a box, Docker's on a laptop). |
| `web` | `fabrium-web:<git sha>`, built from `deploy/Dockerfile` | Caddy serving `packages/web/dist`, `/config.json`, and proxying `/_matrix/*` to Tuwunel. HTTPS is automatic for a public domain. |

Per-instance state lives outside the repo, under `ZOOID_HOME` (default `~/zooid`):

```
.env                          secrets and instance settings (mode 600)   ← you edit
workforce/zooid.yaml          daemon config                               ← you edit
workforce/agents/<name>/      agent workdirs: AGENTS.md, opencode.json, clones…
workforce/data/               tasks.json, vapid.json, agents/*/sessions.json, run/*.sock
home/                         the daemon's HOME: agent auth (.config/opencode, .local/share/opencode, .claude)
data/matrix/db, media         Tuwunel database and media                  ← the valuable part
data/matrix/config/           tuwunel.toml + registrations/zooid.yaml     (rendered by deploy.sh)
web/config.json               UI runtime config                           (rendered by deploy.sh)
app/context-mcp/              context-mcp bundle copied out of the image  (by deploy.sh)
backups/                      backup.sh output
deploy.log                    one line per successful deploy
```

`ZOOID_HOME` must be the same absolute path on the host and inside the daemon container, and
`ZOOID_HOME/workforce/data/run` must be at most 81 characters (Unix socket path limit). `deploy.sh` checks both.

## Scripts

| Script | What it does |
|---|---|
| `deploy/provision.sh` | Fresh Ubuntu 24.04 box: installs rootless podman and the docker CLI + compose plugin (no Docker daemon), enables the user podman socket and the restart at boot, clones the repo, creates the `ZOOID_HOME` layout, generates `.env` (with fresh tokens) and `zooid.yaml` from the examples when missing. Idempotent. |
| `deploy/deploy.sh` | `git fetch` + fast-forward pull of the branch the checkout is on, render the config files, `docker compose build`, `up -d`, wait for health, print a summary. Run it for every code or config change. A new commit rebuilds both images (full `pnpm install` + `pnpm build`, a few minutes on the box) and recreates every container; a run without new commits hits the build cache and recreates nothing. |
| `deploy/backup.sh` | Stops `zooid` and `tuwunel`, tars the essential state (owner-only file), restarts them. |
| `deploy/restore.sh` | Extracts a backup into an empty `ZOOID_HOME`. |
| `deploy/compose.sh` | `docker compose` bound to this instance, for `logs`, `ps`, `stop`, `start`, `down`. |

All scripts take `-h`. They never print secret values.

## First deploy on a new box

1. Create the Lightsail/EC2 instance (Ubuntu 24.04), open TCP 22, 80 and 443 in its firewall, attach a static IP
   and point the DNS record (`fabrium.net`) at it. Caddy obtains the certificate on first start and needs both ports reachable.
2. On the box:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/jan3dev/fabrium-web-ui/feat/deploy/deploy/provision.sh -o provision.sh
   bash provision.sh            # or: bash provision.sh --branch main
   ```
   Open a new shell (or `source ~/.bashrc`) so `DOCKER_HOST` points the docker CLI at podman.
3. Edit `~/zooid/.env`: `SERVER_NAME`, `SITE_ADDRESS`, `HOMESERVER_URL`, agent secrets (`GH_TOKEN`, `HAVEN_API_KEY`, …).
   See `deploy/.env.example` for every key. Format: `KEY=value`, one per line; no inline comments after a
   value, no `$` in values, no quotes needed. `deploy.sh` refuses `<placeholders>`.
4. Edit `~/zooid/workforce/zooid.yaml` (agents, rooms). Rules: `runtime: docker`, `homeserver: http://tuwunel:8448`,
   `port` equal to `APPSERVICE_PORT`, `user_namespace` host equal to `SERVER_NAME`.
5. Put agent credentials under `~/zooid/home/` (for opencode: `.config/opencode/` and `.local/share/opencode/`).
   The daemon mounts those directories into every agent container.
6. `~/fabrium-web-ui/deploy/deploy.sh`

## Engine: rootless podman

A box runs rootless podman, driven by the docker CLI through podman's Docker-compatible socket
(`DOCKER_HOST=unix:///run/user/<uid>/podman/podman.sock`, set in `~/.bashrc` by `provision.sh`).
`deploy.sh` detects podman and then:

- mounts that socket into the daemon container (`DOCKER_SOCK`);
- runs the daemon as uid 0 in the container, which is the deploy user on the host, so every file
  under `ZOOID_HOME`, including what agents write, belongs to that user;
- builds with the classic builder (`DOCKER_BUILDKIT=0`, `COMPOSE_BAKE=false`), because podman has no BuildKit API.

After a reboot, `podman-restart.service` (user unit, enabled by `provision.sh`, needs linger) starts every
container with `restart: always`. The daemon restarts its agents itself.

## Routine deploy

```bash
~/fabrium-web-ui/deploy/deploy.sh                  # pull the current branch, rebuild what changed, restart
~/fabrium-web-ui/deploy/deploy.sh --ref main       # switch the instance to another branch
~/fabrium-web-ui/deploy/deploy.sh --no-pull        # redeploy the current checkout (config change only)
~/fabrium-web-ui/deploy/deploy.sh --refresh-agent-images   # also pull newer ghcr.io/zooid-ai/agent-* images
```

`deploy.sh` refuses to pull over uncommitted changes in the checkout. After a change to `zooid.yaml` or `.env`,
run `deploy.sh --no-pull`: it re-renders the config files and recreates only the containers whose
configuration changed (a hash of `zooid.yaml`, `tuwunel.toml` and the registration is a label on the
`zooid` and `tuwunel` containers). A first start on a new box takes a few minutes: the daemon pulls the agent
images before it listens.

Push notifications: Tuwunel's default `ip_range_denylist` blocks private networks, so the push gateway is
published through Caddy at `HOMESERVER_URL/_matrix/push/*` instead of the compose network. On a public domain
this works as is; on a laptop (`HOMESERVER_URL=http://localhost:…`) Tuwunel resolves `localhost` to itself and
push delivery does not work. Chat, agents and everything else do.

Logs and status (`deploy/compose.sh` is `docker compose` with this instance's project, env file and
variables; use it for `logs`, `ps`, `stop`, `start`, `down`, but start or update the stack with `deploy.sh`,
because a manual `up` lacks the values `deploy.sh` computes):

```bash
~/fabrium-web-ui/deploy/compose.sh logs -f zooid        # daemon
~/fabrium-web-ui/deploy/compose.sh logs -f tuwunel      # homeserver
~/fabrium-web-ui/deploy/compose.sh ps
docker ps --filter ancestor=ghcr.io/zooid-ai/agent-opencode:latest   # running agents
```

## Migrations

- **zooid** has no database and no migrations. Its state files are versioned JSON (`tasks.json`, `sessions.json`);
  an unknown version is treated as empty, never converted. Upgrading the daemon is just a deploy.
- **Tuwunel** migrates its RocksDB on start when the image is newer, with no way back. That is why
  `TUWUNEL_IMAGE` is pinned by digest. To upgrade: run `backup.sh`, set `TUWUNEL_IMAGE` in `.env` to the new
  digest, run `deploy.sh --no-pull`.

## Backup and restore

```bash
deploy/backup.sh                       # ~/zooid/backups/zooid-<UTC>.tar.gz + .sha256 (stack stopped for a few seconds)
deploy/restore.sh zooid-<UTC>.tar.gz   # into an empty ZOOID_HOME, then run deploy.sh
```

The backup contains `.env`, the Matrix DB/media/config, `zooid.yaml`, `workforce/data` (minus sockets),
`home/`, and the agent workdirs minus `node_modules`, `.pnpm-store`, `.cache`, attachments and any git clone
(a first-level directory with `.git`). Agents lose nothing that matters: the chat history is in Matrix, and
an agent starts a fresh session on its next message.

## Moving the current prod instance to this layout

The prod box (Lightsail `zooid`) runs the daemon from npm with systemd user units and Caddy on the host.
Its state maps 1:1 onto `ZOOID_HOME`:

| On the old box | In `ZOOID_HOME` | Note |
|---|---|---|
| `~/zooid/.env` | `.env` | Add `SITE_ADDRESS`, `HOMESERVER_URL`, keep the two Matrix tokens and the agent secrets. `SERVER_NAME` stays `fabrium.net`. |
| `~/zooid/workforce/zooid.yaml` | `workforce/zooid.yaml` | Change `runtime: podman` → `docker`, `homeserver: http://localhost:8448` → `http://tuwunel:8448`. |
| `~/zooid/workforce/agents/s-meow/{AGENTS.md,opencode.json,.claude}` | `workforce/agents/s-meow/` | Skip the git clones and `.pnpm-store`. |
| `~/zooid/workforce/data/` | `workforce/data/` | Keep `vapid.json`; drop `run/`. |
| `~/zooid/data/matrix/db`, `media` | `data/matrix/db`, `media` | Copy with the old `zooid-tuwunel.service` stopped. |
| `~/zooid/data/matrix/config/*` | — | Re-rendered by `deploy.sh` (the registration URL changes from `host.docker.internal:9000` to `zooid:9000`). |
| `~/.config/opencode`, `~/.local/share/opencode` | `home/.config/opencode`, `home/.local/share/opencode` | Agent auth. |
| `/var/www/zoon/config.json`, `/etc/caddy/Caddyfile` | — | Replaced by the rendered `web/config.json` and the image's Caddyfile. |

Steps: stop the old units (`systemctl --user stop zooid zooid-tuwunel`) and Caddy on the old box, tar the
paths above:

```bash
tar -C ~ -czf zooid-prod.tar.gz \
  --exclude='zooid/workforce/agents/*/.pnpm-store' --exclude='zooid/workforce/agents/*/node_modules' \
  --exclude='zooid/workforce/agents/*/bitgifted*' --exclude='zooid/workforce/data/run' \
  zooid/.env zooid/workforce zooid/data/matrix/db zooid/data/matrix/media .config/opencode .local/share/opencode
```

(adjust the clone names to what `ls ~/zooid/workforce/agents/*/` shows), copy the tarball to the new box,
unpack it into the layout above, edit `.env` and `zooid.yaml` as in the table, run `deploy.sh`, test through
the IP, then move DNS. The Matrix server name (`fabrium.net`) must not change: it is embedded in every user
and room ID.

## Local test (macOS or Linux, Docker Desktop or Docker CE)

The whole stack runs on a laptop with a short `ZOOID_HOME` and plain HTTP. Pick host ports that nothing
else uses (`lsof -nP -iTCP:8089 -sTCP:LISTEN` must print nothing; a process bound to `127.0.0.1:<port>`
makes the health check fail while the IPv6 `localhost` still answers):

```bash
export ZOOID_HOME=$HOME/zooid-local SERVER_NAME=localhost SITE_ADDRESS=:80 \
       HOMESERVER_URL=http://localhost:8089 HTTP_PORT=8089 HTTPS_PORT=8449 \
       MATRIX_AS_TOKEN=$(openssl rand -hex 32) MATRIX_HS_TOKEN=$(openssl rand -hex 32)
mkdir -p $ZOOID_HOME/workforce && cp deploy/templates/zooid.yaml.example $ZOOID_HOME/workforce/zooid.yaml
# edit user_namespace to '@.*:localhost' and set the agent env you need
deploy/deploy.sh --no-pull
```

`deploy.sh` accepts the settings from the environment when `ZOOID_HOME/.env` does not exist. Then:

```bash
curl -s localhost:8089/config.json
curl -s localhost:8089/_matrix/client/versions
curl -s 127.0.0.1:9000/healthz
```

Create a user through the appservice (registration is closed). With a `password` the user can log in from
the UI at `http://localhost:8089`; without one the call only returns an access token. The same call, against
`HOMESERVER_URL`, creates accounts on a real instance:

```bash
curl -s -X POST "localhost:8089/_matrix/client/v3/register?kind=user" \
  -H "Authorization: Bearer $MATRIX_AS_TOKEN" -H 'content-type: application/json' \
  -d '{"type":"m.login.application_service","username":"andy","password":"<choose one>"}'
```

To see an agent start, invite that user to `#zooid`, send a message that mentions the agent, and watch
`docker ps`: a `ghcr.io/zooid-ai/agent-*` container appears with `/zooid/context-mcp` and `/zooid/context.sock`
mounted from `ZOOID_HOME`.

Tear down: `docker compose -p fabrium down -v && rm -rf ~/zooid-local`.
