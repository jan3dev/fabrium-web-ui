---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'zooid': minor
---

A new optional setting, `agents.<name>.matrix.senders`, lists the Matrix user IDs that an agent answers. Without it, the agent answers everybody, as before. With a list of 1 to 20 user IDs, compared byte for byte, the agent answers only those users. Any other value, `[]` too, is a config error, and zooid does not start. `fabrium-agent-sync` writes the list that the control plane gives, and skips an agent whose list breaks the rule.

An agent with `senders` starts a turn only for those users: a mention, a follow-up in a thread, a task, and the trigger `any`. Only they answer its questions, approve its tool calls, interrupt it, or reset its session; an event from anybody else is dropped without an answer. The agent still takes the return of an agent that it called, while that call is open.

Effects: a cron or webhook trigger no longer reaches such an agent, because a trigger posts as a bot. Another agent cannot call it: a handoff or a task to it on the same daemon is refused at once, and the agent cannot give a task to itself. It still reads the history of its rooms, so this is a routing filter, not isolation. An older zooid ignores the key and runs the agent without a filter.
