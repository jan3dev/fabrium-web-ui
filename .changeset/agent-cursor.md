---
'zooid': minor
'@zooid/transport-matrix': minor
'@zooid/context-mcp': minor
---

Agent cursor (plan row P6, DESIGN_MODES_SPEC.md §6.8). With previews on, a local agent gets `zooid_preview_focus`: `{ identifier, selector }` for an artifact or `{ name, path, selector }` for a preview page; no `selector` clears it. The supervisor checks it (one selector on one line, at most 300 characters; threads only; a named preview must exist) and sends it over the tunnel as live state, one focus per agent, never a timeline event. The gateway keeps it per agent, drops it when the workstation's tunnel closes, and serves it to room members at `GET /_fabrium/v1/previews/focus?room=<room>`; `GET /previews/<agent>/<name>` carries `focus: { path, selector }` when the agent works on that preview. The transport calls a new `onTurnEnd(agentUserId, threadRoot)` option at the end of every turn, and the daemon clears the agent's focus in that thread.

The router ignores a message whose content has `"dev.fabrium.quiet": true`: the web UI sends artifact comments the user did not send to the agent that way (DESIGN_MODES_SPEC.md §6.6), so they stay in the thread without waking any agent, `trigger: any` included.
