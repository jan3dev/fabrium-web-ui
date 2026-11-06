---
'@zooid/core': minor
'@zooid/context-mcp': minor
'@zooid/transport-matrix': minor
'@zooid/acp-client': minor
'zooid': minor
---

Agents can attach files to their current thread with `zooid_send_attachment` ([[ZOD068]]). Give it a path (relative to the workspace, or absolute) plus an optional `name` and `caption`; the daemon uploads the file as the agent and posts a threaded `m.image` (small PNG/JPEG/GIF/WebP) or `m.file`, returning `{ event_id, mxc_uri }`. Container agents can only attach from `/workspace`. Failures come back to the agent and show as a `⚠ [attachment_failed]` notice in the thread.
