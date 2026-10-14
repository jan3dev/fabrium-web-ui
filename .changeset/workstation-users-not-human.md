---
'@zooid/transport-matrix': patch
'zooid': patch
---

The daemon no longer takes a user of another workstation for a human. A workstation's agent can act as any user in that workstation's namespace, and the roster lists only the agents. Now every user in the namespace of a workstation with a roster in the space (its sender `@<workstation>` and every `@<workstation>.*`) counts as an agent: the daemon ignores its approval and elicitation responses, and routes its messages as an agent's, never through the rules for humans.

A workstation's own daemon (`createMatrixTransport({ workstation })`) still routes the unrostered users of its namespace, such as a trigger bot (`as: <workstation>.cron`), like humans, so its triggers keep waking its agents. It never accepts their approval or elicitation responses. Other daemons route these bots as agents: to wake an agent on another daemon, run the trigger on a daemon without a workstation, as a bot outside every workstation namespace (for example `as: cron`).
