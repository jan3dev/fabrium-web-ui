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
workstations/<ws>/            agent VM bundle: .env with the VM tokens, workforce/zooid.yaml (by add-workstation.sh)
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
| `deploy/add-workstation.sh` | Admits an agent VM: writes its tokens and tuwunel registration, adds its users to the workforce space and its rooms, publishes its roster entry. See [Agent VM](#agent-vm-workstation). |
| `deploy/agent-vm/prepare-image.sh` | Prepares a VM to become the agent VM image: installs Node 22, pnpm, opencode, gh and Docker CE, builds the zooid CLI at a commit. No bundle, no service. See [Build a VM image](#build-a-vm-image). |
| `deploy/agent-vm/provision.sh` | Runs on an agent VM made from the image: checks the bundle and the VM token, builds the zooid CLI only when `--ref` is not the image's commit, runs it as a systemd user service. Installs nothing. Idempotent; also the update path. |
| `deploy/agent-vm/configure-agent.sh` | Runs on an agent VM after `provision.sh`, for `preset: opencode`: stores the Haven and GitHub variables in `secrets.env`, writes `opencode.json`, checks one opencode turn on Haven, configures git, restarts the agent. See [Configure an opencode agent](#configure-an-opencode-agent). |

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
`home/`, the agent VM bundles (`workstations/`), and the agent workdirs minus `node_modules`, `.pnpm-store`,
`.cache`, attachments and any git clone (a first-level directory with `.git`). Agents lose nothing that
matters: the chat history is in Matrix, and an agent starts a fresh session on its next message.

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

## Agent VM (workstation)

An agent can run on its own VM instead of in a container on this box. The VM runs a second zooid
daemon: a *workstation* with one agent, in client mode. It reads with `/sync` over HTTPS and opens no
port, so the VM can be on AWS or on an external server, also behind NAT. The agent is a plain process
of the VM, with the access of the VM user: Docker and, on AWS, sudo. Container agents on this box do
not change.

```
this box                                            agent VM (one agent)
Caddy :443 ─ /_matrix/* ─► tuwunel  ◄──── HTTPS ──── zooid, systemd user service fabrium-agent
  registrations/zooid.yaml + vm1.yaml                 workstation: vm1, mode: client
zooid: container agents, cron triggers                runtime: local ─► the agent process
```

| Item | Where |
|---|---|
| VM tokens and tuwunel registration (users `@vm1\..*`) | this box, `deploy/add-workstation.sh` |
| Agent ID | `@<workstation>.<agent>:SERVER_NAME`, for example `@vm1.coder:fabrium.net` |
| Roster entry (persona, project, rooms) | published by this box; the VM cannot change it |
| Cron | `triggers:` in this box's `zooid.yaml` |
| Agent credentials, instructions and secrets (`~/zooid/secrets.env`) | on the VM, put there by the operator (`configure-agent.sh` for an opencode agent) |

### Admit a VM (on this box)

The rooms must exist. Run the script before the VM's first start:

```bash
deploy/add-workstation.sh vm1 --agent coder --room '#zooid' --persona Coder --project Fabrium
```

It writes the bundle for the VM in `ZOOID_HOME/workstations/vm1/` (`.env` with new tokens and
`workforce/zooid.yaml`), writes `registrations/vm1.yaml` and restarts tuwunel. Then it checks with
`whoami` that tuwunel accepts the VM token as `@vm1` and the central token as `@zooid`. If a step fails,
it puts the previous registration back, restarts tuwunel again and names the step that failed. Then it
adds `@vm1` to the workforce space, and `@vm1.coder` to the space and the rooms, at power level 0. It
warns when one of them has a higher level. Last, it publishes the roster entry `vm1`. A new or changed
registration restarts tuwunel: the chat is down for a few seconds for every user of the instance.

Run it again to change the persona, the project or the rooms. Give all of them on each run: it publishes
the roster entry from its arguments, so a run without `--persona` removes the persona. It keeps the tokens
and the bundle's `zooid.yaml`: keep the rooms in the VM's `zooid.yaml` equal to `--room`. If an earlier run
stopped before tuwunel loaded the registration, the next run restarts tuwunel once. The script stops before
it touches the registration in these cases:

- `--agent` is not the agent of the bundle. One VM runs one agent: to change it, remove the VM first.
- `registrations/vm1.yaml` exists, but `workstations/vm1/.env` does not. Restore `workstations/vm1/`
  from a backup, or copy `~/zooid/.env` and `~/zooid/workforce/zooid.yaml` back from the VM. Or remove
  the registration to make new tokens: this cuts off the running VM.
- Another registration contains a token of the bundle.

When it must invite a VM user again (for example after the user left a room), stop the agent on the VM
first (`systemctl --user stop fabrium-agent`).

### Prepare the VM

1. Create a VM from the agent VM image (see [Build a VM image](#build-a-vm-image)). Inbound: SSH for the
   operator only. Outbound: HTTPS to `SITE_ADDRESS`. Without an image, start from Ubuntu 24.04 and do steps 1
   and 2 of [Build a VM image](#build-a-vm-image) on the VM first.
2. Copy the bundle. It holds the VM tokens:
   ```bash
   tar -C ~/zooid/workstations/vm1 -cf - .env workforce | ssh <vm> 'mkdir -p ~/zooid && tar -C ~/zooid -xf -'
   ```
   A new copy replaces `~/zooid/.env` and `~/zooid/workforce/zooid.yaml` on the VM. It does not touch
   `~/zooid/secrets.env`.
3. On the VM, as the user that runs the agent, with the commit this box runs (pushed to GitHub):
   ```bash
   bash ~/fabrium-web-ui/deploy/agent-vm/provision.sh --ref <sha>
   ```
   `provision.sh` installs nothing: the image has the tools and the CLI. With the commit of the image, it skips
   the build; with another commit, it runs `pnpm install` and the build. It checks the VM token with `whoami`
   before it stops or starts the agent: the zooid log cannot prove the token (the sync loop starts before the
   first `/sync`, and a rejected token only warns). On an update, it stops the agent before it changes the code.
   `--ref` takes a branch or a commit SHA; a commit that no branch head contains needs its full SHA. It stops
   when another Node comes first in PATH or in the PATH of the systemd user instance. The agent starts `node`
   and `opencode` from that PATH, where `/usr/local/bin` comes before `/usr/bin`, so it would run on that Node.
   If the SSH session can drop, run it detached, for example
   `nohup setsid bash ~/fabrium-web-ui/deploy/agent-vm/provision.sh --ref <sha> >provision.log 2>&1 </dev/null &`.
   It is idempotent: run it again after an interruption.
4. Configure the agent. For `preset: opencode`, run `configure-agent.sh` (see
   [Configure an opencode agent](#configure-an-opencode-agent)). For another preset, give the agent its
   credentials (for example `~/.claude`) and its secrets in `~/zooid/secrets.env` (`KEY=value` lines, mode 600;
   `provision.sh` creates the file empty), then run `systemctl --user restart fabrium-agent`. Put the agent's
   instructions in `~/zooid/workforce/agents/<agent>/`.

Logs: `journalctl --user -u fabrium-agent -f`. Two warnings at each start are expected:
`m.space.child(…) failed: … 403` and `workforce roster publication failed: … 403`. The VM has power
level 0; this box publishes its roster entry.

Update the VM every time this box deploys a new commit: `bash ~/fabrium-web-ui/deploy/agent-vm/provision.sh
--ref <sha>`. All daemons of a workforce must run the same version (see the CLI changelog). When a commit
changes a pinned tool version (Node, pnpm, opencode), build a new image: `provision.sh` installs nothing.

To pin the harness version with an image, replace `runtime: local` with `runtime: docker` and add a
`container.image` in the VM's `zooid.yaml`. This is optional and not recommended: in a container the
agent cannot use the VM directly or start other containers.

### Configure an opencode agent

`deploy/agent-vm/configure-agent.sh` configures an agent with `preset: opencode`: inference on Haven, and
GitHub access for git and `gh`. Run it on the VM as the user that runs the agent, after `provision.sh`, and
again after a variable changes. It takes each variable from the environment, or from `~/zooid/secrets.env`
when the environment does not set it. Then it stores the variables in `secrets.env`: the service reads only
that file, and the agent gets the environment of the service.

| Variable | Required | Use |
|---|---|---|
| `HAVEN_API_KEY` | yes | Haven API key (`hvn1_…`). opencode reads it from the environment |
| `HAVEN_MODEL` | yes | A Haven model with tool calling, for example `glm-5-3`. When the model is wrong, the script lists the models on Haven |
| `GH_TOKEN` | no | GitHub token for git and `gh`. Without it, the agent cannot push or open pull requests. Needs `gh` on the VM |
| `GIT_USER_NAME`, `GIT_USER_EMAIL` | no | The git author. Default: the name and the noreply address of the `GH_TOKEN` account |

```bash
read -rsp 'Haven key: ' HAVEN_API_KEY; echo; export HAVEN_API_KEY
read -rsp 'GitHub token: ' GH_TOKEN; echo; export GH_TOKEN
HAVEN_MODEL=glm-5-3 bash ~/fabrium-web-ui/deploy/agent-vm/configure-agent.sh
```

`read -s` keeps the values off the screen and out of the shell history. When the checkout on the VM does not
have the script, download it from a commit that has it:
`curl -fsSL https://raw.githubusercontent.com/jan3dev/fabrium-web-ui/<sha>/deploy/agent-vm/configure-agent.sh -o configure-agent.sh`.
The script does not change the checkout or the build.

The script:

1. Stops when the bundle does not use `preset: opencode` and `runtime: local`. For another preset, it prints
   the commands for this box.
2. Stops when `~/.config/opencode/opencode.json` sets a `model` or a `haven` or `haven-local` provider:
   opencode merges that file with the agent's config.
3. Writes `opencode.json` in the agent's working directory. It sets `model` and `provider.haven`; the other
   keys stay.
4. Runs one opencode turn with the binary, the environment files and the working directory of the service
   (`systemd-run --user`). The model must read a file with a tool, so the turn checks the key, the model and
   tool calling. The first turn installs the provider package and can take a few minutes. The script stores
   the variables before this turn: after a failed turn, `secrets.env` holds the new values, and the agent
   keeps the old ones until it restarts.
5. With `GH_TOKEN`: checks the token, sets the git author and runs `gh auth setup-git`. git gets the token
   from the environment at each call, so the token is only in `secrets.env`.
6. Restarts `fabrium-agent` and waits for its sync loop.

Haven limits that shape `opencode.json`:

- Haven rejects request bodies above 256 KB. opencode sends the whole conversation and the tool output on
  each turn, so `limit.context` is 64000, far below the window of the model: opencode compacts the
  conversation first. A `413` from Haven means that a request was still too large.
- The Haven model list does not show which models can call tools. The test turn checks it.
- Keep the Haven balance above about $2. Below that, Haven refuses overlapping requests with HTTP `409`.

The agent can read `HAVEN_API_KEY` and `GH_TOKEN`. Use a fine-grained GitHub token limited to the repos that
the agent needs.

### Build a VM image

An image holds everything an agent VM needs except the bundle: Node 22, pnpm, opencode (the version that the
`agent-opencode` image pins), gh, Docker CE, linger, and the repo with the CLI built at one commit. The build reads
no bundle, so the image holds no token. `deploy/agent-vm/prepare-image.sh` prepares a VM for the image. It
stops when `~/zooid` or the `fabrium-agent` unit exists: every VM made from the image would act as that VM.

1. Start a fresh VM from Ubuntu 24.04 or from your base image. Remove every Node that is not Node 22
   (`which -a node`): the script stops when another Node comes first in PATH. Remove every opencode that npm
   did not install (`which -a opencode`; the opencode installer puts one in `~/.opencode/bin`): a shell on the
   VM would run it instead of the agent's opencode, so the script stops when it finds one.
2. On the VM, with the commit this box runs:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/jan3dev/fabrium-web-ui/<sha>/deploy/agent-vm/prepare-image.sh -o prepare-image.sh
   nohup setsid bash prepare-image.sh --ref <sha> >prepare-image.log 2>&1 </dev/null &
   ```
3. Check that the disk holds no credential: for example `~/.aws`, `~/.claude`, `~/.config/gh`,
   `~/.local/share/opencode/auth.json` and tokens in `~/.npmrc`. Then clean the VM and stop it:
   ```bash
   unset HISTFILE
   rm -f ~/prepare-image.sh ~/prepare-image.log ~/.bash_history ~/.zsh_history
   sudo journalctl --rotate && sudo journalctl --vacuum-time=1s
   sudo cloud-init clean --logs --machine-id
   sudo rm -f /etc/ssh/ssh_host_*
   sudo poweroff
   ```
   cloud-init makes new SSH host keys and a new machine ID at the first start of each VM.
4. Create the image from the stopped VM, with the commit in its name. On AWS:
   `aws ec2 create-image --instance-id <id> --name fabrium-agent-<sha>`.

On a VM made from the image, start at step 2 of [Prepare the VM](#prepare-the-vm). An image holds one commit:
after this box deploys a new commit, `provision.sh` builds the new commit on each VM, or you build a new image.

### Test without a model

`--preset echo` writes the repo's echo fixture as the agent: it replies `echo: <text>` and asks for one
approval per turn. It needs no credentials. Use it on staging to check admission, `/sync`, mentions and
approvals:

```bash
deploy/add-workstation.sh vm1 --agent echo --room '#general' --preset echo
```

To change the preset later, delete the bundle's `workforce/zooid.yaml`, run the script again with the new
`--preset` and the same `--room`, `--persona` and `--project`, and copy the bundle again. The agent name stays.
The registration does not change, so tuwunel does not restart.

### Cron for a VM agent

Triggers stay on this box. Mention the agent by its full ID, and give the room as a full alias:

```yaml
triggers:
  daily-report:
    schedule: '0 9 * * *'
    as: cron
    room: '#zooid:fabrium.net'
    mention: '@vm1.coder:fabrium.net'
    text: 'Daily report, please.'
```

Do not add `triggers:` to the VM's `zooid.yaml`. At power level 0 the VM cannot invite its trigger bot
(`@vm1.cron`) to the space, the bot cannot join the rooms, and the daemon stops at start with
`joinRoom(…) failed: 403`.

### Security

- The agent inherits the daemon environment, so it can read the VM token. With it, it can act as `@vm1`
  and `@vm1.*`: read and send in their rooms, and join any `restricted` room of the space. Keep
  sensitive rooms invite-only. It cannot act as other users (`M_EXCLUSIVE`).
- The daemons treat `@vm1` and every `@vm1.*` user as non-human while `vm1` has a roster entry. They
  ignore the approval and elicitation responses of these users, and their messages never count as a
  human's.
- At power level 0 the VM cannot change the roster or the space.
- The registration has no alias namespace: with one, the agent (which can read the VM token) could create any
  free `#alias`. The rooms must exist before admission.
- One agent per VM.

### Remove a VM

1. Stop the agent on the VM (`systemctl --user disable --now fabrium-agent`) or destroy the VM.
2. On this box, remove the registration, then the bundle. After the restart, the VM token stops working:
   `rm ~/zooid/data/matrix/config/registrations/vm1.yaml && deploy/compose.sh restart tuwunel`, then
   `rm -r ~/zooid/workstations/vm1`.
3. With `MATRIX_AS_TOKEN` in the shell, remove the users from the agent's rooms and from the space, then
   empty the roster entry. Do this after step 2: without the roster entry, the daemons no longer treat
   `@vm1` and `@vm1.*` as non-human. `ROOMS` holds the room IDs and the space ID last:
   ```bash
   h="Authorization: Bearer $MATRIX_AS_TOKEN" j="content-type: application/json"
   for r in $ROOMS; do
     for u in @vm1:fabrium.net @vm1.coder:fabrium.net; do
       curl -s -X POST -H "$h" -H "$j" "http://127.0.0.1:8448/_matrix/client/v3/rooms/$r/kick" -d "{\"user_id\":\"$u\"}"
     done
   done
   curl -s -X PUT -H "$h" -H "$j" "http://127.0.0.1:8448/_matrix/client/v3/rooms/$SPACE_ID/state/dev.zooid.workforce/vm1" -d '{}'
   ```
   Without the roster entry, the UI no longer marks `@vm1.coder` as an agent: its old messages show
   without the `agent` badge. To keep the badge on that history, skip the last command.

### Local simulation

`deploy/agent-vm/sim/` runs the VM as a container next to the [local test](#local-test-macos-or-linux-docker-desktop-or-docker-ce)
stack, with an echo agent that replies once and asks for one approval per turn. In the shell of the local
test (`SERVER_NAME=localhost`):

```bash
deploy/add-workstation.sh vm1 --agent echo --room '#zooid'
STACK_PROJECT=fabrium docker compose -p fabrium-vm-sim -f deploy/agent-vm/sim/compose.yml up -d --build
docker logs -f fabrium-vm-sim-agent-vm-1      # expect: pull mode: 1 sync loop(s) running
```

`STACK_PROJECT` is the compose project of the local stack. Mention `@vm1.echo` in `#zooid` from the UI,
approve, and the reply appears. To start the bundle's own config instead of the echo agent, set
`SIM_ZOOID_YAML=$ZOOID_HOME/workstations/vm1/workforce/zooid.yaml`. The simulation creates the working
directory of the bundle's agent. The bundle's `preset: claude` still needs harness credentials in
`$ZOOID_HOME/vm-sim/home`, the `HOME` of the container. Tear down:
`docker compose -p fabrium-vm-sim -f deploy/agent-vm/sim/compose.yml down && rm -rf $ZOOID_HOME/vm-sim`.
