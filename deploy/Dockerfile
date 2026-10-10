# syntax=docker/dockerfile:1
# Build context: repo root (see deploy/docker-compose.yml, `context: ..`).

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
RUN pnpm build

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
LABEL org.opencontainers.image.title="fabrium-zooid" \
      org.opencontainers.image.source="https://github.com/jan3dev/fabrium-web-ui" \
      org.opencontainers.image.revision="${GIT_SHA}"
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=prod /src /app
ENV NODE_ENV=production
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.APPSERVICE_PORT||9000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "/app/packages/cli/dist/bin.js"]
CMD ["start"]

# ---- web: Caddy serving the UI dist and proxying Matrix to tuwunel ----
FROM caddy:2.11-alpine AS web
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="fabrium-web" \
      org.opencontainers.image.source="https://github.com/jan3dev/fabrium-web-ui" \
      org.opencontainers.image.revision="${GIT_SHA}"
COPY --from=build /src/packages/web/dist /srv/www
COPY deploy/Caddyfile /etc/caddy/Caddyfile
