---
'zooid': minor
---

A VM has an auto-stop setting: the number of hours of uptime after which it stops itself, from 1 to 168. The VM page asks for it when you create a VM and when you start a stopped VM, and it defaults to 12. The daemon accepts `auto_stop_hours` on `POST /vms` and an optional `{"auto_stop_hours": N}` body on `POST /vms/{id}/start`, and forwards it to the control plane. A start without a body keeps the current value.
