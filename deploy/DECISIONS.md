# Deploy stack: decisions taken and decisions still open

This file records the choices behind `deploy/` and the questions that still need an
owner. Each open item lists the current default so the stack works without an answer.

## Decisions taken

| Topic | Decision | Why |
|---|---|---|
| Unit of deployment | One Docker Compose project (`tuwunel`, `zooid`, `web`) built from this repo. | `zooid start` no longer serves the web UI and the npm package no longer ships it (PR #1), so the daemon and the UI must come from the same checkout. A compose stack is testable on a laptop and needs only Docker and git on the box. |
| Where the daemon runs | Inside a container, with the engine socket mounted; agent containers are siblings. | The daemon passes host paths to `docker run -v`, so `ZOOID_HOME` is mounted at the same absolute path inside and outside, `HOME` points to `ZOOID_HOME/home`, and `ZOOID_CONTEXT_MCP_HOST_DIR` gives the host copy of the context-mcp bundle. The alternative (daemon on the host under systemd, built with pnpm on the box) needs a Node toolchain on the server and cannot be tested on macOS. |
| Web UI | Caddy image built with `packages/web/dist`; `/config.json` rendered by `deploy.sh`. | Same layout as the current prod (Caddy in front of a static dist and the homeserver). |
| Tuwunel version | Pinned by digest to the image prod runs today. | Tuwunel migrates its RocksDB on upgrade with no way back. Upgrades are an explicit `TUWUNEL_IMAGE` change, after a backup. |
| Instance state | Everything under `ZOOID_HOME` (default `~/zooid`): `.env`, `workforce/`, `data/matrix/`, `home/`. | Mirrors the current prod layout, so `backup.sh`/`restore.sh` move the essential state (Matrix DB with chats and accounts, `zooid.yaml`, agent persona files, secrets) as a single tarball. |
| Instance env file | `ZOOID_HOME/.env` is optional; the same keys may come from the shell environment. | Lets CI and local tests run without writing a secrets file. The production path still uses the file (created by `provision.sh`). |
| Reproducible image IDs | `deploy.sh` builds with `SOURCE_DATE_EPOCH` = commit time and `BUILDX_NO_DEFAULT_ATTESTATIONS=1`. | With the containerd image store the image ID is the OCI index digest; default attestations and the export timestamp change it on every build, and then `compose up` recreates the containers on every deploy even when nothing changed. Verified locally: same ID across builds, second deploy recreates nothing. |
| Config rendering | `tuwunel.toml`, the appservice registration and `config.json` are rendered from templates on every deploy. `zooid.yaml` is never rewritten. | The registration URL changes between layouts (`host.docker.internal:9000` in the old prod, `zooid:9000` in compose). Rendering from `.env` keeps the two tokens in sync between Tuwunel and the daemon. |

## Open decisions (defaults in effect)

1. **Rootful Docker CE vs rootless engine.** Default: Docker CE from Docker's apt repo, rootful.
   Prod today uses rootless podman. With a rootful engine the daemon's socket access is root-equivalent
   on the box. Options: Docker rootless mode (`dockerd-rootless-setuptool.sh`, needs
   `net.ipv4.ip_unprivileged_port_start=0` for ports 80/443) or podman with `podman.socket` and
   `podman compose`. Both need a test pass; the compose file has no Docker-only features.
2. **Agent images.** Default: the upstream `ghcr.io/zooid-ai/agent-*:latest` images (unpinned, pulled by the
   daemon on first start; `deploy.sh --refresh-agent-images` pulls newer ones). The fork's
   `publish-agent-images.yml` still pushes to `zooid-ai` and would fail here. Decide whether to build and
   pin images under `ghcr.io/jan3dev` (needs the preset image names in `packages/acp-client/src/presets.ts`
   and the four Dockerfiles changed) or keep upstream's.
3. **Agents run as root inside their containers.** Upstream passes no `--user`. On a rootful engine, files
   the agents write under `workforce/agents/<name>/` belong to root on the host. Consequences: `backup.sh`
   needs read access (`sudo deploy/backup.sh --zooid-home /home/<user>/zooid`, because `sudo` resets `HOME`),
   and the daemon, which runs as the deploy user, cannot write into root-owned directories an agent created
   (attachments go to `<workdir>/.zooid/attachments`; the daemon creates that directory first, so this only
   bites when an agent deletes and recreates it). Not changed in this branch.
4. **Prod cutover.** Default: migrate the current prod data with `backup.sh`-style tar (manual on the old
   layout, see `README.md`) into a freshly provisioned box (`zooid-stage` exists), then move DNS. The public IP
   of the Lightsail instances is not static; attach a static IP before the cutover. Alternative: run
   `provision.sh` + `deploy.sh` on the existing prod box after stopping the user units and Caddy.
5. **Push notifications.** Default: enabled as soon as the daemon creates `workforce/data/vapid.json`
   (`config.json` then carries `push_gateway_url` and `vapid_public_key`). The gateway URL is
   `HOMESERVER_URL/_matrix/push/v1/notify`, routed by Caddy to the daemon, because Tuwunel's default
   `ip_range_denylist` blocks the compose network. Prod today runs without push. Alternative: set
   `ip_range_denylist = []` in the Tuwunel template and point the gateway at `http://zooid:9000` directly.
6. **Admin access to Tuwunel.** Default: `TUWUNEL_BIND=127.0.0.1:8448` publishes the homeserver on the box's
   loopback for `curl` scripts (same as prod today). `deploy.sh` also uses it for the health check, so it must
   stay a `host:port` on the box; change the port if 8448 is taken.
7. **Account creation.** Registration is closed (`allow_registration = false`). Accounts are created through
   the appservice API with `MATRIX_AS_TOKEN` (see `README.md`). A helper script (`create-user.sh`) is a
   candidate follow-up.
8. **Branch per instance.** Default: an instance tracks the branch it was cloned on (`feat/deploy` until the
   PR merges, then `main`). `deploy.sh --ref <branch>` switches.
9. **Build on the box vs build elsewhere.** Default: `deploy.sh` builds on the instance (2 vCPU, 4 GB on the
   Medium plan). If that proves slow or runs out of memory, build on a laptop or in CI and ship the images
   with `docker save`/`docker load` or a registry; `deploy.sh --no-build` then only restarts the stack.
10. **Secrets on the command line.** Upstream passes agent env as `-e K=V` on the `docker run` command line,
    so secrets are visible in `ps` on the box. Unchanged here.
11. **Push gateway is public.** Caddy routes `/_matrix/push/*` to the daemon for everyone; anyone who learns a
    push key can trigger pushes to that device. Same exposure as any Matrix push gateway on a public host.

## Follow-ups noted in review, not done

- `deploy.sh` renders the config files before the build; if the build fails and a container crash-restarts,
  it reads the new config with the old image. Rendering to a staging path and swapping after the build would
  close this.
- `ZOOID_CONTEXT_MCP_HOST_DIR` is not validated by the daemon (a relative path becomes a named volume).
  `deploy.sh` always passes an absolute path.
- `backup.sh` stops `zooid` and `tuwunel`; the daemon stops its agent containers on SIGTERM, which was
  observed locally, but this is not verified on a box with long-running agents.
- A `create-user.sh` helper around the appservice registration call (see README) would avoid hand-written curl.
