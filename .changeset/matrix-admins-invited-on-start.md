---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'@zooid/cli': minor
---

Add `transports.<name>.admins` (a list of MXIDs) to zooid.yaml. On every `zooid start`/`zooid dev` those users, merged with `--admin-user`, are invited to the workforce space, every agent room and `#general`, including rooms that already exist. Config now rejects an agent room alias equal to the workforce space alias (default `#dev`).
