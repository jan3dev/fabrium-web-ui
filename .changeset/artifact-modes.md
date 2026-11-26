---
'@zooid/core': minor
'@zooid/transport-matrix': minor
'@zooid/context-mcp': minor
---

`zooid_artifact` takes three new types that open the web client's artifact panel in a matching mode: `slides` (a deck, one `<section>` per 1920×1080 slide), `design` (screens as `<section>` artboards) and `design-system` (one JSON object with colors, spacing, typography, radius, shadows, components and assets). The tool text tells the agent which type fits which request. The daemon refuses a slides or design version without a `<section>` and a design system that is not a JSON object, also after `edits`. The tool text also names the slide conventions the viewer reads: speaker notes in `<aside data-notes>`, `data-skip` (left out of Present and the PDF export) and `data-transition="fade|slide"`, and says that sections a script adds at run time are not listed.
