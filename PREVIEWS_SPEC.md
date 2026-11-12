# Live app previews: spec

Status: draft, 2026-11-06. Owner: web UI. Replaces the backlog row "P6 Preview tab" in [`FABRIUM_WEB_UI_PLAN.md`](./FABRIUM_WEB_UI_PLAN.md) §4.

## 1. Goal

A user asks an agent in a thread to build a website or an app. The agent starts the app, and the user sees it running beside the conversation, clicks through it, and asks for changes, all without leaving Fabrium. This is the core Replit loop: prompt, build, live preview, iterate. We do not copy Replit's IDE.

**In v1:** a live preview of an agent's running app (any HTTP dev server: Vite, Next.js, Rails, Flask, plain static files), app logs, browser console errors, and one click to send an error back to the agent.

**Not in v1:** a code editor, a file tree, a user terminal, deploy or publish, databases, a secrets UI, or native mobile builds. The agent edits the code. These items are in §11.

### Relation to artifacts

Artifacts (`dev.fabrium.artifact.version`, built) are single files rendered in the browser from the event body, with no process behind them. A preview is a running process on the agent's workstation. Use an artifact for a component or a one-page mockup. Use a preview when the result needs a dev server, several files, an API, or a database. Both open in the same place in the UI (§3.2).

### Where it runs

Agents run on VMs that accept no inbound connections (`deploy/README.md`, "Agent VM": inbound SSH for the operator only, outbound HTTPS only, possibly behind NAT). The browser cannot reach the app directly. So the feature has three parts:

```
Web UI (browser)  ──https──►  central box: Caddy + zooid gateway  ◄──outbound tunnel──  agent VM: zooid workstation + app
```

The to-do lists in §9 follow these three parts.

## 2. On/off

There is one switch per layer. Each defaults to off. Remove the switch, and nothing of the feature runs or renders.

| Layer | Switch | Off means |
| --- | --- | --- |
| Web | `config.json` → `previews: true` (`RuntimeConfig`, resolved like `global_search` in `client/feature-flags.ts`) | No cards, no header button, `?preview=` ignored. Preview events render their plain-text `body`. |
| Daemon (central and VM) | `zooid.yaml` → `previews: true` or `{ origin, tunnel_url, max }` | No MCP tools for the agent. The `/_fabrium/v1/previews*` routes return 404, which the UI already reads as "off" (`isNoAccess`). |
| Deploy | `.env` → `PREVIEW_DOMAIN` | No Caddy site block for previews. |

All web code lives in `src/components/previews/*`, `src/events/fabrium-preview.ts` and `src/hooks/use-preview*.ts`, with two mount points: the panel in `logged-in-view.tsx` and `RoomPreviewMenu` in `room-header.tsx`. Preview annotations reuse `lib/artifacts/refs.ts` (the optional `preview` field). To remove the feature, delete the folder and the mount points.

## 3. User experience

### 3.1 The loop

1. The user writes in a thread: "@coder build a todo app with Vite."
2. The agent writes the code, then calls `zooid_preview_start` (§4.1). A **preview card** appears in the thread at once, with status *Starting*.
3. When the app listens on its port, the card turns to *Running*. On desktop, the preview opens automatically the first time a preview starts in a thread that the user is viewing. After that, it opens only on click.
4. The user clicks around. Vite or Next HMR updates the page live while the agent edits (the WebSocket passes through the tunnel).
5. Something breaks. The console drawer shows the error, and the user clicks **Ask agent to fix**. The composer fills with an @mention of the agent and a short request; the error rides along as an annotation chip that names the preview and the current path (the same `dev.fabrium.artifact_refs` as artifact annotations). The user edits the text and sends it. Nothing is sent automatically.

### 3.2 Layout

The preview uses the same layout as the artifact panel: the preview takes the main pane and the thread stays on the right. URL: `?thread=<root>&preview=<agent ID>/<name>`, which is mutually exclusive with `&artifact=`.

```
┌ room header ────────────────────────────────────────── [▶ Preview ▾] ┬───────────────┐
│ ‹  ›  ⟳  │ /todos?filter=done                 │ ▭ ▯ ▮ │ ↗ │ ⋯ │ ✕ │ Thread        │
├──────────────────────────────────────────────────────────────────────┤               │
│                                                                      │ you: build a  │
│                     app (iframe, preview origin)                     │ todo app      │
│                                                                      │               │
│                                                                      │ coder · Web   │
│                                                                      │ [preview card]│
├──────────────────────────────────────────────────────────────────────┤               │
│ ▸ Console  2 errors · Logs        ● Running         [Ask agent to fix] │ [composer]    │
└──────────────────────────────────────────────────────────────────────┴───────────────┘
```

- **Toolbar:** Back, Forward, Reload, a path field (path and query only; the host is fixed and never shown), device width (Desktop = fill, Tablet 768, Phone 390, stored in `fabrium:preview-device:v1`), Open in new tab, a `⋯` menu (Restart app, Stop app, Copy link), and Close.
- **Room header button** `Preview`: shown only while the room has a running preview. With more than one, it opens a list (title, agent, status).
- **Mobile:** the panel is full screen, with a segmented control `Preview | Thread`.

### 3.3 States

The parent draws these states over the iframe, so the user never looks at a blank frame.

| State | Shows | Actions |
| --- | --- | --- |
| Starting | Spinner, `Starting <title>…`, the last 5 log lines, live | Stop |
| Running | The app | All |
| Crashed | `App stopped (exit 1)`, the last 20 log lines | Restart app, Ask agent to fix |
| Stopped | `App stopped by <name> <time>` | Restart app (humans only) |
| Workstation offline | `<agent>'s workstation is offline` | — |

### 3.4 Console drawer

The drawer is collapsed by default. A badge shows the error count. It has two tabs:
- **Console:** `console.error`, `window.onerror` and `unhandledrejection` events from the page, reported by the bridge (§5.3). Each entry is capped at 2 KB, and the drawer keeps the latest 50.
- **Logs:** stdout and stderr of the app process, the last 64 KB, live.

Every entry has a **Copy** button and an **Ask agent to fix** button.

### 3.5 Copy rules

Follow `AGENTS.md`: never write "server" in the UI. Use "app": *Restart app*, *App stopped*, *Starting app…*. Use "workstation" for the agent's machine. Use "preview" for the panel.

### 3.6 Card

```
┌──────────────────────────────────────────┐
│ ● Running   Todo app                     │
│ npm run dev                              │
│ [ Open preview ]                     ↗   │
└──────────────────────────────────────────┘
```

The card shows the latest event for its preview ID, merged with the live status from the API (§5.4). Agent-authored text in the card is plain text, never HTML.

### 3.7 Who can do what

| Action | Human room member | Agent (tool) | Guest |
| --- | --- | --- | --- |
| Open, interact | ✓ | — | ✓ |
| Restart, stop | ✓ | ✓ (own previews) | — |
| Start | — | ✓ | — |

### 3.8 Expo Go: open on a phone (M2)

For a React Native app built with Expo, the user runs the app natively on their own phone in Expo Go, alongside the web preview.

1. The agent starts the app with `kind: "expo"` (§4.1). The card and the panel toolbar show **Open on phone**.
2. **Open on phone** opens a popover with a QR code, the text `Scan with Expo Go`, the link (Copy button), and the expiry time. Scanning opens the app in Expo Go. Fast Refresh updates the phone while the agent edits.
3. The panel itself shows the Expo web build (`expo start` serves it on the same port when the project has web support). Without web support, the panel shows `This app runs on a phone. Use Open on phone.` instead of a broken frame.

```
┌ Open on phone ───────────────────┐
│  ▄▄▄▄▄▄▄  ▄ ▄  ▄▄▄▄▄▄▄           │
│  █ ▄▄▄ █ ▀█▄█  █ ▄▄▄ █           │
│  █ ███ █  ▄▀▄  █ ███ █           │
│  ▀▀▀▀▀▀▀ ▀ ▀   ▀▀▀▀▀▀▀           │
│  Scan with Expo Go               │
│  exps://3f9c….fabrium-preview…   │
│  [ Copy link ]   Expires 22:14   │
└──────────────────────────────────┘
```

- The QR encodes a session URL from `POST …/session` with the scheme `exps://` instead of `https://`. It is the same credential as the web link: whoever scans it can use the app until it expires (D3).
- **Requires M2:** the phone must reach the preview origin over the internet with a valid certificate. `*.preview.localhost` does not work from a phone, so local `zooid dev` hides **Open on phone**.
- **Limits:** Expo Go runs only the SDK versions it ships with, and only JavaScript plus the native modules bundled in Expo Go. A project with custom native code needs a development build, which is out of scope. The tool result tells the agent this when the logs show an SDK mismatch.

## 4. VM side: workstation daemon

### 4.1 MCP tools (`packages/context-mcp`)

These tools are registered only when `previews` is configured, the same way `canSendAttachment` gates its tool, and only for `runtime: local` agents that `previews.agents` lists (default: all of them). The daemon runs the command, outside the agent's harness and its permission prompts: turning previews on for an agent lets it run shell commands on the workstation.

```
zooid_preview_start({ name, command, title?, port?, cwd?, env?, kind? = "web" }) → { name, status, port, exit_code, logs_tail }
zooid_preview_stop({ name })
zooid_preview_logs({ name, lines? = 100 }) → string
```

- `name` is kebab-case and stable. Starting the same name again restarts it with the new command.
- The daemon runs `sh -c <command>` in the agent's working directory with `PORT=<port>` set. `cwd` must resolve (symlinks included) inside that directory. `env` cannot set `PATH`, `HOME`, `PORT`, `SHELL`, `ENV`, `BASH_ENV`, `NODE_OPTIONS`, `LD_*` or `DYLD_*`. When `port` is not given, it allocates one from 20000–29999. The tool description tells the model to bind to `$PORT` on `127.0.0.1` or `0.0.0.0`.
- The call returns when the port accepts TCP connections, or after 60 s with status `crashed` or `starting` and the log tail, so the agent can fix the problem in the same turn.
- The daemon sends the `dev.fabrium.preview` event (§6) into the current thread.
- `kind: "expo"` marks an Expo app (§3.8). The supervisor also sets `CI=1`, so `expo start` does not wait for keyboard input. The tool description tells the model to run `npx expo start --port $PORT`, and never `--tunnel` or `--lan`: the preview gateway is the tunnel.

### 4.2 Supervisor

- The daemon owns the process, not the agent's harness. Harnesses kill background shells when a turn ends, and a preview has to outlive the turn.
- **Environment:** a clean environment (`PATH`, `HOME`, `LANG`, `PORT`, the tool's `env`). **Never** the daemon's environment: it holds `MATRIX_AS_TOKEN` and the contents of `secrets.env`.
- On crash, it reports `crashed` with the exit code and the log, and does not restart on its own: a crashing dev app is almost always a code error. The agent or a human restarts it.
- The registry is saved to `<data dir>/previews.json`, and previews restart when the daemon starts.
- At most `max` (default 3) previews per workstation. The oldest one stops first.
- v1 supports `runtime: local`, which is the agent VM path and also `zooid dev`. `runtime: docker` is backlog: the containers are unnamed (`docker run --rm -i`), so there is nothing to exec into.

### 4.3 Tunnel client

- **Control:** the workstation daemon opens one long-lived HTTP/1.1 `Upgrade: fabrium-tunnel` connection to `/_fabrium/v1/tunnel` on the central box, authenticated with its appservice token, which it already holds. Messages are newline-delimited JSON in both directions: `state`, `log`, `remove` up; `open {stream, preview}`, `restart`, `stop` down; `ping` both ways.
- **Data:** on `open`, the workstation dials `/_fabrium/v1/tunnel/stream/<n>` with another upgrade and pipes raw bytes to `127.0.0.1:<port>`. Because this is a byte pipe, HTTP/1.1, keep-alive, SSE and WebSocket (HMR) all work without special cases.
- It dials only `127.0.0.1` on ports it registered. It refuses any other target the central box names.
- Both sides send `ping` every 20 s and drop a connection that stays silent for 60 s: TCP keepalive takes minutes to notice a NAT drop or a laptop that slept. The workstation then reconnects with backoff (1 s, doubling to 30 s). While it is disconnected, the central box reports `offline`.
- **No new dependency:** Node `http` exposes the `'upgrade'` event on both client and server, and Caddy passes upgrades through.

## 5. Central box: gateway, API, deploy

### 5.1 Tunnel server

The central box accepts the control and stream upgrades from §4.3, checks the appservice token against the workstation's registration, and pairs each browser TCP connection with a stream. Agents on the central box itself use the same tunnel over loopback: one code path.

### 5.2 Preview origin and access

- Each preview session gets its own origin: `https://<token>.<PREVIEW_DOMAIN>`, where the token is 128 random bits. It is bound to (preview, user) and expires after 12 h, on stop, or when the user leaves the room. The gateway checks room membership again at most once a minute, so a user who leaves loses the preview within a minute, open WebSockets included. The web UI asks for a new session on each run of the app.
- The unguessable host is the credential. No cookies are needed, which matters because the iframe is cross-site and Safari blocks third-party cookies. The same link works in a new tab.
- `PREVIEW_DOMAIN` must be a **separate registrable domain** (e.g. `fabrium-preview.net`), not a subdomain of the app. The daemon refuses to start when `previews.origin` is on the homeserver's site, and the panel refuses a session URL on Fabrium's site. This keeps cookies, storage and the app's `SameSite` boundary apart (plan rule: "never embed previews in the client origin").
- Sessions under one `PREVIEW_DOMAIN` share a registrable domain, so an app could set a cookie for all of them. The gateway strips `Domain=` from `Set-Cookie`. Cookies that page script sets bypass the gateway: list the domain in the Public Suffix List (private section) to close that, or accept the risk (D1).
- TLS: wildcard certificate via DNS-01 (D2).
- Local `zooid dev`: `http://<token>.preview.localhost:<gateway-port>`. Browsers resolve `*.localhost` to loopback, so no DNS or TLS setup is needed.

### 5.3 What the gateway changes in transit

- **Request:** set `Host: localhost`, so dev servers with host checks (Vite `allowedHosts`, webpack) accept it. The public host goes in `X-Forwarded-Host` and `X-Forwarded-Proto`. **Expo:** Metro writes the bundle and asset URLs of its manifest from the request's host, and Expo Go then fetches those URLs. For `kind: "expo"`, the gateway passes the public Host through unchanged, so the manifest points back at the preview origin (D8). `X-Forwarded-Proto` is always the scheme of the preview origin (`https` when deployed), never the client's header. Drop `Cookie` headers that are not for the preview. Set `Accept-Encoding: identity` for HTML.
- **HTML response:** insert `<script src="/__fabrium/bridge.js"></script>` as the first child of `<head>`. It is same-origin, so `script-src 'self'` CSPs allow it.
- **Every response:** `Referrer-Policy: no-referrer`, and `X-Frame-Options` / `frame-ancestors` replaced with `frame-ancestors <app origin>`.
- **`/__fabrium/*`:** reserved for gateway routes. Everything else goes to the app.
- **Bridge** (about 3.5 KB): on load, `popstate`, `pushState`, `replaceState` and `hashchange`, it posts `{href, title}` to the parent with `targetOrigin = <app origin>`. It forwards console errors (§3.4) and accepts `back`, `forward`, `reload` and `pick` from the parent. In pick mode it outlines the hovered element and reports the clicked one (selector, HTML, text, page) instead of letting the app act on the click.

### 5.4 Service API (`/_fabrium/v1`, OpenID auth as today)

| Route | Who | Returns |
| --- | --- | --- |
| `GET /previews?room=<id>` | room member | the previews of that room (state, no log) |
| `GET /previews/<agent>/<name>?log_offset=<n>` | room member | `{ ...state, log: { offset, text } }`; the UI polls it every 1.5 s while the panel is open |
| `POST /previews/<agent>/<name>/session` | joined member of the room, not an agent | `{ url, expires_at }` (§5.2) |
| `POST /previews/<agent>/<name>/restart`, `/stop` | human member | `204` |

Room membership is read as the preview's agent, with its workstation's appservice token (the central `@zooid` user is not in every room). Agents are refused on session, restart and stop. Restart and stop are relayed to the workstation over the control channel.

### 5.5 Iframe (web side of the origin contract)

`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"` (popups keep the sandbox), `referrerpolicy="no-referrer"`, `allow` empty. `allow-same-origin` is safe here only because the origin is foreign to the app. The parent accepts a bridge message only when `event.source` is its iframe and `event.origin` is the session origin. This is the same check that `artifact-preview.tsx` does today.

## 6. Matrix event

`dev.fabrium.preview` is a message event in the agent's thread, sent by the workstation daemon as the agent. It is sent on start and on stop: "something happened", not live state. Live state comes from §5.4, so status changes do not flood the timeline.

```json
{
  "msgtype": "m.notice",
  "body": "Preview: Todo app (npm run dev)",
  "dev.fabrium.preview": { "name": "todo-app", "title": "Todo app", "command": "npm run dev", "kind": "web", "action": "started" },
  "m.relates_to": { "rel_type": "m.thread", "event_id": "$root" }
}
```

- The decoder `src/events/fabrium-preview.ts` follows the same shape as `approval.ts`, with a vitest. The UI folds events by `(room, thread, sender, name)`, latest first, like artifacts. A missing `kind` means `web`.
- **Trust:** the sender must be an agent in the workforce roster. The event carries no URL and no port.
- **Sealed rooms:** previews are off (plan §5, sealed rooms). The tool refuses to start, and the UI ignores these events there.

## 7. Security summary

- The UI never navigates the iframe to an address that comes from an event or from the agent. Only `POST /session` returns the URL, and only to members.
- The preview runs on a separate site, so it cannot read Fabrium cookies, storage, the DOM or Matrix tokens.
- The app process does not get the daemon's secrets (§4.2).
- The workstation dials only its own registered loopback ports. The gateway accepts no arbitrary upstream.
- The agent's text in the card and in log lines renders as text.
- **SEV-SNP VMs:** preview traffic leaves the enclave at the gateway. This is decision D4.

## 8. Milestones

| Milestone | Scope | Done when |
| --- | --- | --- |
| **M1: local** | Everything over loopback in `zooid dev`: supervisor, tools, tunnel, gateway on `*.preview.localhost`, event, card, panel, states, Logs tab, flags | e2e: an agent starts a Vite app in `zooid dev`; the user opens it, HMR updates on edit, a crash shows logs and Restart works |
| **M2: VM** | Tunnel over the internet, `PREVIEW_DOMAIN`, Caddy block, DNS-01 certificate, token revocation, VM config, Expo Go | The same e2e against an agent VM behind NAT; an agent starts an Expo app on the VM, the user scans the QR code with Expo Go on a phone, and an edit reaches the phone through Fast Refresh |
| **M3: fix loop** | Bridge (URL bar, Back/Forward, console), Ask agent to fix, annotate, device widths, header list, mobile | axe passes in both themes; stories for card, toolbar, drawer and each state |

## 9. To-dos

All code is in this repo. The split is by where it runs.

### 9.1 Web UI (`packages/web`)

These can start now against a mocked API and fixture events. Storybook and unit tests need no backend.

- [x] M1: Add `previews?: boolean` to `RuntimeConfig` and `loadRuntimeConfig` (`client/runtime-config.ts`), with a resolver in `client/feature-flags.ts` that defaults to off. Add a test.
- [x] M1: Add `Preview`, `PreviewStatus` and `PreviewSession` to `model/types.ts`.
- [x] M1: Add the decoder `events/fabrium-preview.ts` with a vitest. Sender must be a roster agent; ignore the event in encrypted rooms.
- [x] M1: Add the API calls to `client/fabrium-api.ts`: `listPreviews`, `getPreview`, `createPreviewSession`, `restartPreview`, `stopPreview`.
- [x] M1: Add `hooks/use-previews.ts` (fold events per room, thread and ID) and `hooks/use-preview-status.ts` (polls every 1.5 s, keeps a 64 KB log tail).
- [x] M1: Add `components/previews/preview-card.tsx` with a story, rendered in the timeline for the event.
- [x] M1: Add `components/previews/preview-panel.tsx` (container) and mount it in `logged-in-view.tsx` on `?preview=`, mutually exclusive with `?artifact=`.
- [x] M1: Add `components/previews/preview-state.tsx` (Starting, Crashed, Stopped, Offline) with a story per state.
- [x] M1: Add `components/previews/preview-console.tsx` with the Logs tab, and a story.
- [x] M1: Add the e2e spec `e2e/previews.spec.ts` (Tuwunel; the preview API and origin are mocked with `page.route`).
- [x] M1: Run it for real: an agent in `zooid dev` with `previews: true` starts a Vite app; open it, edit (HMR), crash, restart.
- [x] M2: `kind` in the decoder and the view model (missing = `web`).
- [ ] M2: **Open on phone** popover (`components/previews/preview-phone.tsx`, with a story): QR code of the `exps://` session URL, Copy link, expiry. Shown for `kind: "expo"` when the preview origin is https. Needs a QR encoder (D9).
- [ ] M2: Panel message for an Expo app without a web build.
- [x] M3: Bridge messages: path field, Back/Forward, Console tab and error badge.
- [x] M3: **Ask agent to fix** fills the thread composer (agent @mention, error, path).
- [x] M3: Device widths, stored in `fabrium:preview-device:v1`.
- [x] M3: `Preview` button and list in the room header.
- [x] M3: Mobile `Preview | Thread` segmented control.
- [x] M3: **Annotate:** pick an element in the preview and attach it to the reply, reusing the artifact annotation refs (`dev.fabrium.artifact_refs`). The bridge highlights on hover and reports selector, HTML, text and path (§5.3).
- [x] M3: Extend the axe sweep to the panel and card in both themes.

### 9.2 Central box (`packages/core`, `packages/cli`, `deploy/`)

- [x] M1: Add the `previews:` config schema in `core` (`origin`, `tunnel_url`, `max`).
- [x] M1: Tunnel server (`cli/src/previews/hub.ts`): control and stream upgrades, appservice-token auth, stream pairing.
- [x] M1: Gateway (`cli/src/previews/gateway.ts`): token → preview lookup, Host rewrite, bridge injection, header rules, `/__fabrium/bridge.js`.
- [x] M1: Service API routes (`cli/src/fabrium-api/`): §5.4, a homeserver membership check, 404 when off.
- [x] M1: `zooid dev` serves `*.preview.localhost:<port>` and writes `previews: true` into the generated `config.json`.
- [x] M2: Session token expiry and revocation (stop, leave room, 12 h).
- [ ] M2: Add the preview domain to the web UI's `frame-src` CSP (meta tag in `packages/web/index.html`; M1 allows only `http://*.preview.localhost:*`). Render it per deploy.
- [ ] M2: Deploy: `PREVIEW_DOMAIN` in `.env.example`, a Caddy site block for `*.{$PREVIEW_DOMAIN}` to the gateway, a Caddy image with the DNS provider module (`deploy/Dockerfile` or a compose image), `deploy.sh` writes `previews` into `config.json`.
- [x] M2: Gateway: for `kind: "expo"`, pass the public Host through, with `X-Forwarded-Proto` from the preview origin (§5.3). Tested with a stub app.
- [ ] M2: After the spike: integration test with a recorded Metro manifest: every URL in it points at the preview origin.
- [ ] M2: Document it in `deploy/README.md`: DNS records, certificate, how to turn it off.

### 9.3 VM side (workstation daemon, agent VM image)

The code is in this repo (`packages/cli`, `packages/context-mcp`, `packages/transport-matrix`). It runs on each agent VM and in `zooid dev`.

- [x] M1: Supervisor (`cli/src/previews/supervisor.ts`): spawn with a clean environment, wait for the port, explicit restarts only, `<data dir>/previews.json`, `max`.
- [x] M1: MCP tools in `context-mcp`: `zooid_preview_start`, `_stop`, `_logs`, registered only when `previews` is on. Write the tool description: bind to `$PORT`, return logs on failure.
- [x] M1: Sender for `dev.fabrium.preview` in `transport-matrix` (same pattern as `artifacts.ts`). Refuse in encrypted rooms.
- [x] M1: Tunnel client: the control connection, a stream dial to `127.0.0.1:<registered port>` only, and status and log forwarding.
- [ ] M2: Spike first (D8): run `npx expo start --port $PORT` behind the gateway and check that the manifest URLs and Fast Refresh work through the tunnel from Expo Go on a real phone.
- [x] M2: `kind` in the tool, the supervisor (`CI=1` for Expo), the tunnel state and the event. Tool text for Expo: the command, no `--tunnel`/`--lan`, the Expo Go SDK limit.
- [x] M2: Reconnect with backoff after sleep, NAT drops and central restarts (heartbeat, §4.3).
- [ ] M2: `deploy/agent-vm/zooid.yaml.example`: add the `previews:` block. `add-workstation.sh` and the VM API create flow write it.
- [ ] M2: VM image (`prepare-image.sh`): no change for JavaScript apps (Node 22, pnpm and Docker are already there). Decide whether to add Python and venv (D7).
- [ ] M2: No inbound ports on the VM. Check that the security group stays SSH-only.

## 10. Open decisions

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Preview domain | A separate registrable domain, not `*.preview.<site>` |
| D2 | TLS for random hosts | Wildcard via DNS-01: Caddy built with the DNS provider module. On-demand TLS would issue one certificate per token and hit Let's Encrypt rate limits. |
| D3 | Who can open a link | The token holder, for 12 h, minted only for room members. "Copy link" then shares access until it expires. Alternative: bind to the user with a partitioned cookie (`CHIPS`), which breaks in Safari. |
| D4 | Previews from SEV-SNP VMs | Allow them. The panel shows a `--trust-enclave`-toned note: "Preview traffic leaves the enclave." This needs design-owner sign-off. |
| D5 | Tunnel | Build it in (§4.3, §5.1; no new dependency). The alternative is chisel or frp: a new binary on the VM image and its own auth. |
| D6 | Auto-open on first start | On for desktop, off for mobile |
| D7 | Toolchains in the VM image beyond Node | Python 3 ships with Ubuntu 24.04. Add `python3-venv` only if agents need it. |
| D8 | How Metro learns the public URL | Pass the public Host through for Expo (§5.3), and confirm it in the spike. If Metro ignores it, set `EXPO_PACKAGER_PROXY_URL` per preview. That needs one stable origin per preview instead of one per user session, which weakens D3 for Expo previews. |
| D9 | QR encoder in the web UI | A small, dependency-free package rendering SVG (e.g. `uqr`), vetted with `package-vetting` and noted in the PR. Writing an encoder ourselves is several hundred lines. |

## 11. Backlog (after v1)

- `runtime: docker` support: named containers plus `docker exec`.
- Auto-detect new listening ports in the agent's process tree, and offer "Preview port 3000?".
- Read-only file tree of the agent's workspace.
- Expo development builds (custom native code), and the iOS Simulator or Android emulator streamed into the panel: each needs its own spec.
- Publish: promote a preview to a stable URL. This is Replit's "Deploy" and needs its own spec.
- Screenshot thumbnails on cards.
