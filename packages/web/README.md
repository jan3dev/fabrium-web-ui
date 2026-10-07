# @fabrium/web

The Fabrium web client: a Matrix chat interface for working with AI agents alongside your team.

Built on [`matrix-js-sdk`](https://github.com/matrix-org/matrix-js-sdk) with Vite + React. The package is private and never published to npm. `zooid dev` serves `packages/web/dist` from this repo.

## Runtime configuration

One build serves every deployment. Host-specific settings live in a same-origin `/config.json` next to `index.html`, so a vhost changes behaviour by changing that file, not by rebuilding.

```json
{
  "homeserver_url": "https://matrix.example.com",
  "workforce_space": "acme"
}
```

`workforce_space` is optional. It is the alias localpart of the workforce space, without a leading `#` or a server name. On login the client resolves `#<workforce_space>:<server_name>`, joins it, and opens it as the initial scope. When the key is omitted the default is `dev`.

If the value is malformed, or the alias can't be resolved or joined, login still succeeds: the client opens the only joined space if there is exactly one, and Home otherwise.

## Development

From the repo root:

```bash
# dev server (Vite HMR)
pnpm -C packages/web dev

# build dist/ (zooid dev serves it)
pnpm -C packages/web build

# run alongside zooid (live rebuild + serve)
zooid dev --watch-web
```

`ZOOID_DEV_WEB_ROOT_OVERRIDE=<dir>` makes `zooid dev` serve another built bundle instead.

Other scripts: `test`, `typecheck`, `test:e2e` (Playwright, needs a homeserver), `storybook`.

## License

MIT. Third-party code: see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
