---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'@zooid/context-mcp': minor
'@zooid/pi-extension': minor
'zooid': patch
---

New tool `zooid_design_system` (design modes spec §5.6). Without arguments it lists the design systems in the `dev.fabrium.design_systems` state event (state key `""`, `{ systems: [{ room_id, thread_id, identifier, name, default?, for? }] }`) of the room's project spaces (`m.space.parent`, canonical first) and then of the workforce space; each entry says which kinds it is the default for (`default_for`). With `identifier` it reads that system's latest version as the agent and returns its overview, a `css` block (every token as a CSS variable, one `[data-theme]` rule per theme), tokens with their usage notes, themes, fonts, layout patterns, the component list and icon, logo and asset names; with `component` one component's html. `TransportContextProvider.designSystem` and `MatrixContextProviderOpts.workspaceSpace` are new; the CLI passes the transport's `space`. A message that carries `dev.fabrium.design_system` (the sender's own choice, or `{ off: true }`) adds one line to the agent's turn. The tool text tells the agent to read the default before it writes slides or a design, copy its `css` into the artifact's own `<style>`, use the variables, read usage notes, and check its output against the tokens before it sends; a `design-system` artifact may also hold `themes`, `fonts`, `layout`, `icons` and `logos`.
