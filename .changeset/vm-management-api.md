---
'zooid': minor
---

The daemon serves an API for VM management under `/_fabrium/v1`, for the Fabrium web UI. It is off unless `FABRIUM_CONTROL_PLANE_URL` and `FABRIUM_CONTROL_PLANE_KEY_FILE` are set, and it runs in appservice mode only. The browser calls it with a Matrix OpenID token, and the caller must be an admin or an owner of the workforce space. The routes list, create, start, stop, reboot, and delete VMs through the Fabrium control plane, list the agents that can move to a new VM, and report the role of the caller (`GET /access`).

A new VM gets its Matrix identity from the daemon. The daemon registers the appservice of the VM at run time with `!admin appservices register` in the tuwunel admin room, so tuwunel does not restart. `@zooid` must be a tuwunel server admin once (`!admin users make-user-admin zooid`). The settings are `FABRIUM_CONTROL_PLANE_URL`, `FABRIUM_CONTROL_PLANE_KEY_FILE` (a file with the tenant API key), `FABRIUM_HAVEN_MODEL`, `FABRIUM_VM_ROOMS`, and the existing `ZOOID_HOME`, `HOMESERVER_URL`, and `ZOOID_COMMIT`.
