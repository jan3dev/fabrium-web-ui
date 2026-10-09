---
'zooid': patch
'@zooid/context-mcp': patch
---

When the daemon runs in a container, set `ZOOID_CONTEXT_MCP_HOST_DIR` to the host path of the directory that contains the `@zooid/context-mcp` `bin.js`. The daemon uses it as the bind-mount source for agent containers instead of its own filesystem path, which the container engine on the host cannot see.
