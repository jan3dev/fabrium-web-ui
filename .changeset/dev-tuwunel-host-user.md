---
'zooid': patch
---

`zooid dev` with Docker runs Tuwunel as the host user (`--user <uid>:<gid>`). Before, Tuwunel ran as root and left root-owned files in `data/matrix/db`, which the host user could not delete without sudo. Podman is unchanged: rootless podman already maps container root to the host user.

A data dir that an older `zooid dev` created on Linux can still hold root-owned files, and Tuwunel cannot write them as the host user. Give them back to the host user once: `sudo chown -R "$(id -u):$(id -g)" data/matrix`.
