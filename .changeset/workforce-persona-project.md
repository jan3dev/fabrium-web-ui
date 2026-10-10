---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'zooid': minor
---

Agents take optional `persona` and `project` keys in `zooid.yaml`. The daemon publishes them in the `dev.zooid.workforce` roster, and the web client labels the agent "Persona · Project".

The daemon now ignores a `dev.zooid.approval_response` sent by an agent: agents never approve, not even their own tool calls.
