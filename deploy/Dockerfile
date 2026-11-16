# syntax=docker/dockerfile:1
# Build context: repo root (see deploy/docker-compose.yml, `context: ..`).

# Live app previews: a caddy-dns module, e.g. cloudflare or cloudflare@v0.2.1 (github.com/caddy-dns/<name>).
# Global so `FROM` in the web stage can read it.
ARG PREVIEW_DNS_PROVIDER=

# ---- build: install all deps and build every workspace package (CLI + web) ----
FROM node:22-slim AS build
ENV NODE_OPTIONS=--max-old-space-size=3072 \
    CI=true
RUN npm i -g pnpm@12.9.1
WORKDIR /src
# `pnpm fetch` needs only the lockfile, so the download layer survives source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm/store
# Live app previews: the web UI may frame only the preview domain (frame-src, packages/web/vite.config.ts).
ARG PREVIEW_DOMAIN=
RUN PREVIEW_FRAME_SRC="${PREVIEW_DOMAIN:+https://*.$PREVIEW_DOMAIN}" pnpm build

# ---- prod: the daemon's runtime tree (production deps of `zooid` only) ----
# Paths stay /app/packages/<pkg> so the bundled CLI resolves @zooid/context-mcp/bin
# and @zooid/pi-extension/bundle through the workspace symlinks, and deploy.sh
# finds the context-mcp dist at a fixed path.
FROM build AS prod
RUN rm -rf node_modules packages/*/node_modules packages/web
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --prefer-offline --store-dir /pnpm/store --filter 'zooid...'

# ---- daemon: `zooid start` + docker CLI for sibling agent containers ----
FROM node:22-slim AS daemon
ARG GIT_SHA=unknown
# The full commit, not the short GIT_SHA: the VM management API gives it to a new agent VM, which checks it out.
ARG ZOOID_COMMIT=
LABEL org.opencontainers.image.title="fabrium-zooid" \
      org.opencontainers.image.source="https://github.com/jan3dev/fabrium-web-ui" \
      org.opencontainers.image.revision="${GIT_SHA}"
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=prod /src /app
ENV NODE_ENV=production \
    ZOOID_COMMIT=${ZOOID_COMMIT}
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.APPSERVICE_PORT||9000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/packages/cli/dist/bin.js"]
CMD ["start"]

# ---- caddy-base(-dns): stock Caddy, or Caddy with the DNS module for the preview wildcard certificate ----
# `web` picks one by PREVIEW_DNS_PROVIDER, so a build without previews never pulls the builder image.
FROM caddy:2.11-builder-alpine AS caddy-xcaddy
ARG PREVIEW_DNS_PROVIDER
# The stock binary and the guard: a builder without unused-stage skipping (podman, classic) still runs this stage.
COPY --from=caddy:2.11-alpine /usr/bin/caddy /usr/bin/caddy
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    [ -z "$PREVIEW_DNS_PROVIDER" ] || \
    xcaddy build --with "github.com/caddy-dns/$PREVIEW_DNS_PROVIDER" --output /usr/bin/caddy
FROM caddy:2.11-alpine AS caddy-base
FROM caddy-base AS caddy-base-dns
COPY --from=caddy-xcaddy /usr/bin/caddy /usr/bin/caddy

# ---- web: Caddy serving the UI dist and proxying Matrix to tuwunel ----
FROM caddy-base${PREVIEW_DNS_PROVIDER:+-dns} AS web
ARG GIT_SHA=unknown
ARG PREVIEW_DOMAIN=
ARG PREVIEW_DNS_PROVIDER
LABEL org.opencontainers.image.title="fabrium-web" \
      org.opencontainers.image.source="https://github.com/jan3dev/fabrium-web-ui" \
      org.opencontainers.image.revision="${GIT_SHA}"
COPY --from=build /src/packages/web/dist /srv/www
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# The preview site exists only in an image built with PREVIEW_DOMAIN (deploy/README.md, Live app previews).
RUN --mount=type=bind,source=deploy/Caddyfile.previews,target=/tmp/Caddyfile.previews \
    mkdir -p /etc/caddy/sites \
 && if [ -n "$PREVIEW_DOMAIN" ]; then \
      sed -e "s|__PREVIEW_DOMAIN__|$PREVIEW_DOMAIN|" -e "s|__DNS_PROVIDER__|${PREVIEW_DNS_PROVIDER%%@*}|" \
        /tmp/Caddyfile.previews >/etc/caddy/sites/previews.caddy; \
    fi
