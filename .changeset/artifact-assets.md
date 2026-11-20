---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'@zooid/context-mcp': minor
'@zooid/pi-extension': minor
---

`zooid_artifact` takes `assets`: with only `identifier`, a list of 1 to 100 file paths in the agent's workspace. The daemon uploads each through Matrix media as the agent, sends no version and returns `{ identifier, assets: { "<path>": "mxc://…" } }`; `ArtifactResult.event_id` is now optional. Paths resolve inside the workspace only, also for local agents (no `..` or absolute path outside it, no symlink out of it), and every path is checked before anything is uploaded. Allowed: png, jpg, jpeg, gif, webp, avif, svg up to 10 MB; mp4, webm up to 50 MB; woff2, woff, ttf, otf up to 2 MB. A version may reference at most 100 distinct `mxc://` URIs. The tool text explains `assets` and the `mxc://` references (`src` on `img`, `video`, `source`; `url()` in `@font-face`), and the level-3 conventions for slides and designs: `data-layer`, `data-free`, `data-lock` and `<aside data-note>`.
