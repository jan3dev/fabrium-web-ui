---
'@zooid/transport-matrix': patch
---

A turn that produces no output no longer holds the typing indicator and `dev.zooid.turn.end` for the full 30 s post-turn drain cap. While nothing has arrived (no buffered chunk, nothing flushed) the drain now stops at `drainNoStreamMs` (default 20 s); the 30 s cap still applies once a stream has started.
