---
'zooid': minor
---

The VM API has a vm-creator role (power level 70 in the workforce space): it lists and manages only the VMs that the user created, and moves only their own free agents. The daemon sends the creator to the control plane, which keeps it with the auto-stop hours. `PUT /vms/{id}/auto-stop` changes the hours of a VM. A new agent name must not be the name of an agent of the daemon config or of another workstation. The VM watcher reads its hours from the control plane with a per-VM token and keeps the last answer for when the control plane does not answer.
