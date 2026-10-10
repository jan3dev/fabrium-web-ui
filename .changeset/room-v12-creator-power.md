---
'@zooid/transport-matrix': patch
---

Rooms and the workforce space are created again on homeservers whose default room version is 12 (current Tuwunel). Room v12 gives the creator full power and rejects a `power_levels.users` map that names them; the daemon now leaves its own user out of that map on v12+ rooms. Before, startup left an empty room behind and `#dev` and the agent rooms never appeared.
