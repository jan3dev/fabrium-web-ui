---
'@zooid/transport-matrix': patch
---

A workstation in pull (`client`) mode no longer leaves the workforce space and its rooms on its first sync. That sync replays the invites its bots already accepted (for example when an operator admits the workstation), and the ad-hoc invite rule declined them by leaving the room. The daemon now declines an invite only when the bot is not in the room yet.
