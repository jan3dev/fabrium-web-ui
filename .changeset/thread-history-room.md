---
'@zooid/context-mcp': minor
'@zooid/transport-matrix': minor
'@zooid/core': minor
'@zooid/pi-extension': minor
---

`zooid_get_thread_history` takes an optional `room` (room ID or configured alias) to read a thread in another room the agent has joined. The daemon socket resolves it against the agent's own bindings through the new optional `TransportContextProvider.resolveRoom` and returns `not_in_room: this agent is not a member of <room>` before any homeserver read; omitting `room` reads the current room as before.
