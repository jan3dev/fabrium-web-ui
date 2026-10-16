---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'@zooid/context-mcp': minor
'zooid': minor
---

Agents get a `zooid_artifact` tool (MCP and pi) that shows a page, React component, SVG, markdown document or code in the web client's artifact panel. The daemon posts each version as a `dev.fabrium.artifact.version` event in the agent's thread. It applies `edits` against the agent's latest version itself, so a find/replace that does not match fails back to the model. Bodies over 48 KB go to the media repo with a sha256.
