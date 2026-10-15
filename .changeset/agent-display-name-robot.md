---
'@zooid/transport-matrix': minor
'zooid': minor
---

The daemon ends every agent's display name with " 🤖" (`AGENT_DISPLAY_NAME_SUFFIX`), whether it comes from `display_name` or from the localpart, and adds it only once. Existing agents get it at the next start of their daemon. The web client labels an agent "Name · Project": its display name and its project, falling back to the workforce space name.
