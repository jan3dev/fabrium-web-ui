---
'@zooid/transport-matrix': minor
'@zooid/context-mcp': minor
'@zooid/pi-extension': minor
---

Explicit mode and tweaks (DESIGN_MODES_SPEC.md §6.7, §6.8). A message whose content has `dev.fabrium.artifact_hint: { type }` adds one line to the agent's turn: for `slides`, `design` and `design-system`, "The user chose "<type>" in the composer" with the matching `zooid_artifact` type; for `whiteboard` and `motion`, that Fabrium cannot show them yet and the agent should offer slides or a design. Other values are ignored. `ARTIFACT_INSTRUCTIONS` now tells the agent to use the chosen type, to ask two or three questions or propose an outline before a short slides, design or design-system request, to put a visible placeholder (e.g. "[Q3 revenue: to confirm]") instead of an invented fact and list the placeholders, and to add variations as extra sections named "<name> · option B". `ARTIFACT_DESCRIPTION` documents tweaks: up to 24 controls in `<script type="application/json" data-tweaks>` (`color`, `range`, `select`, `toggle` set a CSS custom property on `:root`; `text` sets the text of `[data-tweak="<name>"]` elements).
