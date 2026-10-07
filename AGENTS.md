# AGENTS.md

## Web UI

- The Fabrium web UI replaces the current Zooid web client (`@zooid/web`). The work follows [`FABRIUM_WEB_UI_PLAN.md`](./FABRIUM_WEB_UI_PLAN.md): which Buzz components to copy, how to apply the Haven design system, the view-model layer, and the work packages W0–W7.
- Read the plan before any change to `packages/web` or `packages/cli/src/web/*`. Its sections §1 (fixed decisions), §3 (design rules) and §8 (licensing headers) are binding.
- The web UI takes Haven's design system without its name: never write `aqua` or `jan3` (any case) in `packages/web`. The plan's §3.6 guard script enforces this.
