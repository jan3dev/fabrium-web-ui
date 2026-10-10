---
'zooid': patch
---

`zooid dev` fails at once with the container engine's error (for example "port is already allocated") when `docker run` exits, instead of waiting 180 seconds and reporting that Tuwunel did not become healthy.
