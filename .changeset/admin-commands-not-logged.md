---
'@zooid/transport-matrix': patch
---

The daemon no longer logs the body of a tuwunel admin command (`!admin …`). The log line of an inbound message keeps the room and the sender. An admin command can carry secrets, such as the tokens of an appservice registration, and the daemon sees the admin room once `@zooid` is a server admin.
