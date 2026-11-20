# Design modes: spec

Status: draft, 2026-11-17. Owner: web UI. Replaces the backlog row "Artifact kinds `whiteboard`, `motion`" and the deferred line "Artifact modes" in [`FABRIUM_WEB_UI_PLAN.md`](./FABRIUM_WEB_UI_PLAN.md) §4.

## 1. Goal

A user asks an agent in a thread for a slide deck, a screen design, a design system, a whiteboard or an animation. The result opens beside the conversation in an editor made for that kind of work. The user changes it by hand, by comment, or by asking the agent, and exports it or hands it to an agent to build.

The reference product is Claude Design, with the Slides, Design systems, Whiteboards and Motion templates that sit beside it. This spec lists what that product does (§3), what Fabrium has today, and how we build the rest in five levels (§8).

**What we build from:** the artifact (`dev.fabrium.artifact.version`, built), its sandboxed frame, its versions, annotations (`dev.fabrium.artifact_refs`) and the style inspector. A design mode is an artifact kind plus an editor for it. No second document store.

**Not in this spec:** live multi-user editing with cursors, "Send to" partner tools, connectors to other apps, per-plan limits and admin toggles per template, Docs, Sheets and Data templates. See §11.

### 1.1 Sources and confidence

The inventory in §3 has a source column:

| Mark | Meaning |
| --- | --- |
| D | Anthropic's help center, Academy tutorials or launch post, read on 2026-11-17 |
| U | Seen in the product by us (screenshots and notes), not in the docs we read |
| T | Third-party review only; may be out of date |

We did not inspect the reference product's code. Everything here is from its documented and visible behavior.

### 1.2 Where Fabrium already differs

- **Versions.** Every change by an agent is a version with a diff (Changes tab). A user's edits autosave into the current version (§5.2). The reference has no version history. We keep ours and add Restore.
- **The agent is a coding agent with a workspace.** "Hand off to a coding agent", "export as PowerPoint" and "render as MP4" are requests to the agent in the same thread, not separate products (§6.9).
- **Sharing is room membership.** Everyone in the room sees the artifact. There is no share dialog.

## 2. Built today (level 0)

| Area | State |
| --- | --- |
| Kinds | `slides`, `design`, `design-system` beside `html`, `svg`, `react`, `markdown`, `code` |
| Mode choice | The agent picks the kind from the request (`zooid_artifact` tool text). No picker in the UI. |
| Slides | One HTML document, one `<section>` per slide (1920×1080). Rail with slide names, previous/next, counter, arrow keys, Present (fullscreen). |
| Design | One HTML document, one `<section>` per screen (`data-width`/`data-height`). Screen list, zoom Fit / 50% / 100%. |
| Design system | One JSON object. Sections Overview, Colors, Spacing, Typography, Corner radius, Shadows, Components, Assets, with counts. **Add** puts a new value into the reply as an annotation. |
| Annotate | Pick an element, write a note; it rides in the reply to the agent. |
| Style inspector | For the picked element: fill, text color, opacity, radius, border (style, color, width), drop shadow, inner shadow, layer blur, background blur, filter, backdrop, rotate, blend mode. Edits are a draft in the frame and go to the agent as CSS in the annotation. |
| Tabs | Preview, Code, Changes. Download (`.html`, `.json`). |
| Not possible today | The user cannot change an artifact. Only the agent writes versions. |

## 3. Feature inventory

Columns: what the reference does, the source (§1.1), what we have, and the level (§8) that builds it. "—" means out of scope (§11).

### 3.1 Starting and choosing a mode

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Start from a prompt | Ask in any conversation; the right template opens | D | Built: the agent picks the kind | 0 |
| Explicit mode picker | "Output" control in the message box and "Make something new" tiles: Slides, Design, Design system, Whiteboard, Motion | D | Missing | 4 |
| Slash commands | `/design`, `/motion` | D | Missing | 4 |
| Clarifying questions | Short requests get questions or an outline first; missing facts become a visible placeholder on the slide | D | The agent may ask in the thread; no rule in the tool text | 4 |
| Variations | "2–3 alternative layouts", each on its own artboard, side by side | D | Possible by prompt; no guidance in the tool text | 4 |
| Design system chip | A chip under the message box names the active design system ("No design system") | D | Missing | 4 |
| Inputs | Screenshots, images, sketches, DOCX/PPTX/XLSX, an existing deck to copy its style, a linked repo, capture from a live website | D | Thread attachments; whether the agent receives them needs a check (§9.2) | 4 |
| Templates and examples | Reusable templates ("Duplicate as template"), example prompts | T | Missing | 5 |

### 3.2 Editor shell (all modes)

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Areas | Top bar, canvas, properties panel; in Slides also the thumbnail list and a formatting toolbar over the selection | D | Header, frame, rail, inspector | 3 |
| Properties toggle | A "Properties" button; `Cmd+\` | D | Inspector shows while annotating | 3 |
| Floating toolbar | Over the selection while the properties panel is closed | D | Missing | 3 |
| Layers list | Tree of the selected artboard's layers, named; select from the list | D | Missing | 3 |
| Zoom | In, out, fit (`Cmd+Plus`, `Cmd+Minus`, `Cmd+0`); 50%–200% | D, T | Design only: Fit / 50% / 100% | 1 |
| Pan | Canvas you can pan and zoom, all artboards on it | D | One artboard at a time | 3 |
| Undo and redo | `Cmd+Z`, `Cmd+Shift+Z` | D | Missing (versions only) | 2 |
| Autosave | No Save button | D | n/a | 2 |
| Layout guides | Show/hide with `Shift+G` | D | Missing | 3 |
| Keyboard access | Every area reachable with `F6`; full table in §7 | D | Rail and frame keys only | 3 |
| Agent cursor | A cursor in the canvas shows where the agent is working | U | Missing (plan row "Agent cursor") | 4 |

### 3.3 Direct editing on the canvas

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Select | Click an element; components get a different outline color | D | Pick mode while annotating | 3 |
| Retype | Double-click text and type; `Cmd+B/I/U` | D | Missing | 3 |
| Move, resize | Drag; arrow keys 1 px, 10 px with Shift. A layer in a row, column or grid swaps with its neighbour instead | D | Missing | 3 |
| Insert text | Toolbar, key `T` | D | Missing | 3 |
| Insert shapes | Rectangle `R`, rounded rectangle `Shift+R`, oval `O`, diamond `D` | D | Missing | 3 |
| Insert line, connector | `L`, `Shift+L` | D | Missing | 3 |
| Insert image | Toolbar, or drop a file on the slide | D | Missing | 3 |
| Insert video | On canvas and whiteboard | U, D | Missing | 3 |
| Insert table | Toolbar; Tab moves between cells | D | Missing | 3 |
| Insert chart | By asking the agent; a snapshot of the data | D | By asking the agent | 0 |
| Insert note | A note on the canvas that the coding agent can read | D | Missing | 3 |
| Insert artboard | Toolbar | D | Missing | 2 |
| Duplicate | `Cmd+D` | D | Missing | 3 |
| Copy, cut, paste | `Cmd+C/X/V` | D | Missing | 3 |
| Delete | Delete or Backspace | D | Missing | 3 |
| Group, ungroup | `Cmd+G`, `Cmd+Shift+G`; Return enters a group | D | Missing | 3 |
| Order | Bring to front `]`, send to back `[` | D | Missing | 3 |
| Flip | `Shift+H`, `Shift+V` | D | Missing | 3 |
| Align | Align elements on the canvas | D | Missing | 3 |
| Select all | `Cmd+A` | D | Missing | 3 |
| Layout-owned objects | Objects that belong to the slide's layout cannot be moved by hand; ask the agent | D | n/a | 3 |

### 3.4 Properties panel

| Group | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Appearance | Fill, opacity, border (style, color, width), corner radius | U | Built (draft only) | 0 → 3 writes it |
| Effects | Drop shadow, inner shadow, layer blur, background blur | U | Built: blur radius only | 3: offset, spread, color |
| Advanced | Filters, backdrop, transform, blend mode | U | Built: filter, backdrop, rotate, blend mode | 3: scale, skew |
| Typography | Font family, size, weight, color, alignment | D | Missing | 3 |
| Layout | Size, position, spacing, layout (row, column, grid, gap, padding) | D | Missing | 3 |
| Color picker | Offers the design system's colors first; reports text-to-background contrast as good or poor | D | Native color input | 3 |
| Slide or artboard | Background color (design-system colors only), size | D, T | Missing | 3 |
| Inspect (view only) | A viewer clicks an element to read its size, spacing and colors | D | Annotate shows computed styles | 3 |

### 3.5 Slides

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Slide preview cards | A thumbnail per slide in a strip; the editor follows the selection | D | Names only | 1 |
| Add slide | From the thumbnails; menu item "Add slide after" | D | Missing | 2 |
| Duplicate slide | Menu item; `Cmd+D` in the list | D | Missing | 2 |
| Copy, paste slide | Copy a slide and paste it, also into another deck | U | Missing | 2 |
| Move slide | Drag a thumbnail; menu "Move left" / "Move right" | D | Missing | 2 |
| Skip slide | Left out of Present and of exports, not deleted | D | Missing | 2 |
| Delete slide | Menu, or Delete; undo restores; a deck keeps one slide | D | Missing | 2 |
| Slide menu | `Shift+F10` on a thumbnail | D | Missing | 2 |
| Grid view | A "Canvas" view shows every slide at once | D | Missing | 1 |
| Zoom | In, out, fit | D | Fit only | 1 |
| Speaker notes | Typed under each slide, or written by the agent; never shown on the slide | D | Missing | 1 read, 2 write |
| Present | Fullscreen. Next: Right, Down, PageDown, Space. Previous: Left, Up, PageUp. Home, End. `1`–`9` jumps. `F` toggles fullscreen. Esc ends. | D | Built without `1`–`9` and `F`; no e2e | 1 |
| Presenter view | "Present with speaker notes": a second window with notes, a clock, the current and the next slide | D | Missing | 1 |
| Transitions | Between slides; kept in the HTML export | D | Missing | 1 |
| Layouts | Slide layouts and reusable components from the design system (comparison table, flowchart, icons) | D, T | Missing | 4 |
| Presence on thumbnails | Shows who is on each slide | D | — | — |
| Deck menu | Rename, Duplicate (the whole deck) | D | Missing | 2 |

### 3.6 Design (screens and prototypes)

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Artboards | Each screen on its own artboard, named, with a position ("artboard 1 of 7") | D | Built: one at a time | 0 |
| Canvas | Pan and zoom over all artboards | D | Missing | 3 |
| Artboard operations | Add, rename, duplicate, delete, move, resize; device presets | D | Missing | 2 |
| Wireframe or high fidelity | Chosen when the project starts | T | By prompt | 4 |
| Play | Run the prototype; viewers can Play | D | The frame is live; scripts run | 0 |
| Responsive targets | Ask for mobile, tablet, desktop | D | `data-width`/`data-height` per artboard | 0 |
| Notes for the builder | Notes on an artboard are read by the coding agent | D | Missing | 3 |

### 3.7 Design systems

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Sections | Overview, Colors, Spacing, Typography, Corner radius, Shadows, Components, Assets, Files | U | Built; Files is the Code tab | 0 |
| Also in the page | Icons, logos, fonts (uploaded files), layout patterns (grid, page structures) | D | Assets only | 4 |
| Themes | Token values per theme (light, dark) | D | One value per token | 4 |
| Usage notes | A note per color and component that the agent reads before using it | D | `description` exists; the agent is not told to read it | 4 |
| Add | An add button per section | U | Built as an annotation | 2 writes it |
| Edit on the page | Overview text, token values, notes, fonts and assets; theme and component code through chat | D | Missing | 2 |
| Component previews | Live previews; layer names in the list | D | Built, static | 0 |
| Create | From chat; from a repo (reads tokens and components, leaves the repo unchanged); from uploaded brand files (logos, fonts, guideline PDFs, token files, finished decks); the first draft is small and the agent asks before it invents values | D | From chat | 4 |
| Re-sync | Updates changed values, adds new ones, keeps notes, asks before it removes a token | D | Missing | 4 |
| Apply | New designs and decks use the default system; the agent checks its output against the system before it shows it | D | Missing: a system lives in one thread | 4 |
| Default and scope | One default per organization; a personal default; turn off for me; several systems at once with a stated order; a slides-only system | D | Missing | 4 |
| Copy per deck | Each deck keeps the system as it was when the deck was made | D | n/a | 4 |
| Files behind the page | Overview, tokens, components, icons and assets as files the agent loads (Slides loads tokens; Design loads tokens and components) | D | One JSON document | 4 |
| Validate | Make a test project to check the system | D | By prompt | 0 |

### 3.8 Comments

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Comment mode | A Comment button; click a spot; a box opens; Return posts | D | Annotate: pick and note | 0 |
| Send to the agent | A "Send to Claude" checkbox per comment; several comments go in one batch and are resolved in one turn | D, T | Every annotation goes in the next reply | 4 |
| Threads | Replies under a comment; the agent answers in the thread | D | The room thread | 4 |
| Markers | Shown while comment mode is on, with the author's name | D | Missing | 4 |
| List | "Show all comments"; the button shows the open count | D | Missing | 4 |
| Edit, resolve | Edit a posted comment; resolved comments close | D | Missing | 4 |
| Draw | Sketch on the canvas; queue several markups | T | Missing | 5 |
| Dictate | Speak a comment | D | — | — |

### 3.9 Tweaks

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Agent-made controls | The agent adds sliders, color pickers and presets for the values that matter (theme color, spacing, timing, animation physics) | D, T | Missing | 4 |
| Toggle | A Tweaks mode shows or hides them | T | Missing | 4 |
| Keep | A changed value applies across the design | D | Missing | 4 |
| Retype in Motion | Tweaks changes on-screen text and timing | D | Missing | 5 |

### 3.10 Whiteboards

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Board | An unbounded board; the agent draws shapes, arrows and sections; anyone rearranges them | D | Missing | 5 |
| Objects | Shapes, arrows, sections, notes, pictures, videos | D | Missing | 5 |
| Input | Type, sketch or dictate | D | Missing (typing only planned) | 5 |
| Agent actions | "Reorganize the board" (group by theme, make a timeline), "Find the gaps", "Focus on one area" (drag over a region and ask about it) | D | Missing | 5 |
| Convert | Turn the board into a document or a deck by asking | D | Missing | 5 |
| Export | PNG | D | Missing | 5 |
| Follow | Follow a teammate around the board | D | — | — |

### 3.11 Motion

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Output | An animation built as code (text, charts, shapes, images) that plays like a short video; no generated footage | D | Missing | 5 |
| Edit | By chat ("slow down the second scene"), or directly; Tweaks retypes text and timing | D | Missing | 5 |
| Timeline | Scenes with timing; play, pause, seek | U | Missing | 5 |
| Export | MP4 | D | Missing | 5 |

### 3.12 Versions, sharing, export

| Feature | Reference behavior | Src | Ours today | Level |
| --- | --- | --- | --- | --- |
| Version history | None; "save what we have", or duplicate | D | Built: versions and diff | 0; Restore in 2 |
| Duplicate | The whole deck or design from its title menu | D | Missing | 2 |
| Access levels | Can view, Commenter, Can edit; link or invite | D | Room membership and power levels | 2 (who may edit) |
| Edit together | Changes appear as they happen (basic, not reliable) | D | — | — |
| Slides export | PDF; web page (`.html`, keeps transitions); current slide as PNG; PowerPoint with current or basic fonts (text, tables, pictures, backgrounds and notes stay editable; charts, icons and shapes become pictures; transitions and skipped slides are dropped); Google Slides | D | `.html` | 1 PDF, 5 the rest |
| Design export | `.zip`, PDF (all artboards), one artboard as PNG, PDF or HTML, standalone HTML, PowerPoint | D | `.html` | 1 PDF, 5 the rest |
| Hand off to a coding agent | A bundle with component structure, tokens, layout and assets; `/design` in the coding tool imports it | D | The agent is in the thread | 5 |
| Send to other tools | Canva, Miro, Figma-like and hosting partners | D | — | — |

## 4. Principles

1. **One document per artifact, in a web format.** Slides and designs stay HTML with one `<section>` per frame. A design system stays JSON. An agent can write and edit all of them with the tools it has, and a download works without Fabrium.
2. **The frame is untrusted.** Agent markup runs only in the sandboxed frame with no network. The frame reports gestures; the app decides what changes (§5.3). No HTML ever travels from the frame into a saved version.
3. **Every change is an event.** A user edit and an agent edit are the same event type in the same thread. Undo, Restore, the diff and the audit trail come from that. Only an agent's event counts as a new version in the UI; a user's edits are saves into the current one (§5.2).
4. **The agent stays the default editor.** Direct editing is for small, exact changes. Structure and content changes go through the thread, where the agent's design-system rules apply.
5. **Build only what works without a new backend service** until level 4 (which needs one new state event) and level 5 (which needs agent-side render tools).

## 5. Architecture

### 5.1 Document conventions

All are plain attributes and elements the agent writes. Unknown ones are ignored.

**Slides and design** (`body > section` per frame, as today), new in this spec:

| Convention | Meaning | Level |
| --- | --- | --- |
| `<aside data-notes>` as a child of the section | Speaker notes, plain text or simple inline markup. Never shown on the slide. | 1 |
| `data-skip` on the section | Left out of Present and exports | 1 |
| `data-transition="none\|fade\|slide"` on `body` or a section | Transition into that slide. Off under `prefers-reduced-motion`. | 1 |
| `<template data-layout="NAME">` in `head` (slides) | A slide layout in the deck's own design: one `<section>` with placeholder text. Names: `blank`, `title`, `section`, `title-body`, `bullets`, `two-columns`, `table`, `quote`, `image-caption`, `closing`. Not a slide, never shown. Add slide offers them (§6.2). | 2 |
| `data-layer="Name"` on any element | Its name in the layers list; else tag and first text | 3 |
| `data-free` on an element | Free-placed: `position: absolute` with `left`, `top`, `width`, `height` in px on the canvas. Move and resize write these four. Other elements stay in the flow: a move writes a `translate` offset, so siblings keep their places. | 3 |
| `data-lock` on an element | Cannot be selected by hand (layout-owned) | 3 |
| `<aside data-note>` in a section | A note for the builder; shown as a note on the canvas, hidden in Present and exports | 3 |
| `<script type="application/json" data-tweaks>` in `head` | Tweaks (§6.7) | 4 |
| `src="mxc://…"` on `img`, `video`, `source`; `url(mxc://…)` in `@font-face` | An uploaded asset (§5.4) | 3 |

**Design system** (JSON), new keys: `themes` (`[{ name, colors: […] }]`, level 4), `fonts` (`[{ name, mxc, weight?, style? }]`, level 4), `icons` and `logos` (same shape as `assets`, level 4), `layout` (`[{ name, value, description? }]`, level 4). Reader limits as today.

**Whiteboard** and **motion**: §6.10, §6.11.

### 5.2 Who writes a version

Today the daemon's `zooid_artifact` tool is the only writer, and `edits` apply to the agent's own latest version (`MatrixContextProvider.latestArtifact`).

From level 2 the web client also sends `dev.fabrium.artifact.version`, as the user, in the same thread, with the same body rules (inline up to 48 KB, else media plus `sha256`, 512 KB cap). Two fields are new and optional:

| Field | Meaning |
| --- | --- |
| `based_on` | Event ID of the version this one was made from |
| `summary` | One line for the version list: "Moved slide 3", "Edited 4 layers" |

Rules:

- The latest version of an identifier is the newest by timeline order, from any author allowed to write (decision D2).
- If a new version's `based_on` is not the version before it, the panel marks it "Made from an older version" and offers the diff. No merge.
- The daemon resolves `edits` against the latest version from any allowed author, not only the agent's own.
- The agent must learn that the user changed the artifact. The daemon adds one line to the next turn ("The user edited artifact `<identifier>`: `<summary>`") and the agent can read the current content with `zooid_artifact` `{ identifier, read: true }`.
- **A user's edits are saves, not versions.** In the UI a version event from a human folds into the version before it: it replaces that version's content, adds no version number and shows no card in the thread. An agent's event always starts a new version. A human's event with no version before it (Duplicate) is version 1. The version list shows that a version was edited, by whom and when. On the wire nothing differs: the daemon reads a save as the latest version.
- A turn's `dev.zooid.turn.end` carries `started_ts`. The "user edited" line covers every save since the previous turn started, so an edit made while the agent worked is reported on the next turn.
- A user version is still a draft until sent: edits collect in memory with a 1.5 s idle debounce and an explicit flush on blur, tab change and close, so a drag does not produce twenty events. Undo and redo work on the unsent stack and, past it, send the older content as a new version.

### 5.3 Edit pipeline

The app keeps the artifact source parsed as an inert document (`DOMParser`; no scripts run in the app). Before it builds the frame it stamps each element with a transient `data-fab-id`. Ids are stripped on save.

```
user gesture in the frame ──op { id, kind, numbers | text }──► app
app: validate op ► apply to the inert source ► post the same op back ► frame shows it
idle ► serialize the inert source ► new version
```

- Ops: `move`, `resize`, `text`, `style`, `attr` (allow-listed attributes only), `insert` (from a fixed template list in the app), `delete`, `duplicate`, `reorder`, `group`, `ungroup`.
- The app validates every op: the id exists, numbers are finite and clamped, text is inserted as text, style properties are on the allow-list (`STYLE_PROPS` grows to cover typography and layout), values pass `cssValue`.
- Elements a script creates at run time have no id and cannot be edited. `react` artifacts stay agent-edited; direct editing covers `slides`, `design` and, for style and text only, `html`.
- Frame operations (add, duplicate, move, skip, delete a slide or artboard; edit notes) need no frame at all: they are operations on `body > section` in the inert source.
- Design-system edits are operations on the parsed JSON.

### 5.4 Assets

The frame has no network (`img-src data: blob:`, `media-src data: blob:`, `font-src data:`), and a document is capped at 512 KB, so images, videos and fonts cannot be inlined.

- The user's file is uploaded through authenticated media. The document refers to it by `mxc://` URI.
- The app finds the `mxc` URIs in the inert source, downloads each through authenticated media, and posts the bytes into the frame. The frame runtime makes its own object URL (a blob URL from the app's origin does not load in the sandboxed frame) and sets it on the element. Fonts need `font-src blob:` added to the CSP.
- Limits (untrusted input either way): images 10 MB, video 50 MB, fonts 2 MB, 100 assets per artifact. SVG is used as an image only, never inlined by the app.
- The agent adds assets with a new `assets` input on `zooid_artifact` (paths in its workspace; the daemon uploads them and returns the `mxc` URIs).
- An exported `.html` inlines the assets as `data:` URIs.

### 5.5 Thumbnails

A preview card is the same frame document shown at one section, in a second sandboxed frame that takes no input (`inert`, `tabindex="-1"`), scaled with a CSS transform. Cards mount only while visible (`IntersectionObserver`), at most 12 at once; the rest show the slide number and name. No screenshot library. The grid view uses the same cards, larger.

### 5.6 Design systems across threads

A design system applies to new work only when agents can find it. One state event in the workspace or project room:

```
dev.fabrium.design_systems   (state_key "")
{ "systems": [{ "room_id", "identifier", "name", "default"?: true, "for"?: ["slides"] }] }
```

- Owners and admins write it (power level of the state event). A user's own default and "off for me" are account data.
- The daemon gives the agent a `zooid_design_system` tool: list the systems, read one (overview, tokens, component list; one component's markup on request). The tool text tells the agent to read the default before it writes a `slides` or `design` artifact, to use the tokens as CSS variables (`--color-<name>` and so on, as the section pages do today), to read a component's `description` before using it, and to check its output against the tokens before it sends.
- A deck or design copies the token variables into its own `<style>`, so it keeps the system as it was when it was made.

## 6. User experience

### 6.1 Shell

```
┌ title ▾ · v7 ▾ ·  Preview | Code | Changes        Comment · Tweaks · Present ▾ · Export ▾ · Properties ┐
├ rail ──────────┬ canvas ───────────────────────────────────────────────┬ properties ─────────────────┤
│ preview cards  │ toolbar: Select · Text · Shape ▾ · Line · Image ·      │ Layers                      │
│ or screens     │          Video · Table · Note        zoom ▾ · grid     │ Appearance · Typography ·   │
│ + Add          │ [ active slide or artboards ]                          │ Layout · Effects · Advanced │
│                │ notes (slides)                                         │                             │
└────────────────┴────────────────────────────────────────────────────────┴─────────────────────────────┘
```

- The title menu holds Rename, Duplicate, Restore this version. Restore saves the old content into the current version.
- Properties is closed by default and remembers its state per user. While it is closed, a floating toolbar over the selection holds the five most used controls.
- Mobile: no rail and no properties panel. Preview cards are a horizontal strip, properties open as a sheet, direct editing is limited to retype, delete and the slide menu.
- Only humans see edit controls. Agents see the viewer (as for Annotate today).
- All new presentational components get a story. Colors come from tokens; the canvas chrome uses no new color.

### 6.2 Slides

- **Rail:** preview cards with number and name; the active card has `aria-current`. A skipped card is dimmed and marked "Skipped". A card changed in the latest version has a dot in the agent's actor color.
- **Slide menu** (button on the card, right-click, `Shift+F10`): Add slide after, Duplicate slide, Copy, Paste after, Move up, Move down, Skip slide / Include slide, Delete slide. Drag a card to move it. A deck keeps at least one slide.
- **Add slide:** opens a layout picker with ten choices, each a live preview in the deck's design: Blank, Title, Section, Title and body, Bullets, Two columns, Table, Quote, Image and caption, Closing. The layouts are the deck's `<template data-layout>` elements (§5.1), which the agent writes with every deck. For a layout the deck does not provide, the app builds the section from plain elements with the deck's slide classes. The chosen layout becomes a new `<section>` after the active one. "Add" at the end of the rail does the same.
- **Copy and paste:** the slide's markup goes to the system clipboard as text. Paste works in any deck in Fabrium; the pasted markup is parsed into the inert source and shows only in the frame.
- **Grid view:** a toggle beside zoom. All slides as cards; click opens one, drag moves, the slide menu works.
- **Zoom:** Fit, 50%, 100%, 200%, and `Cmd+Plus`, `Cmd+Minus`, `Cmd+0`.
- **Notes:** a collapsible text area under the slide ("Speaker notes"). Plain text. The agent writes notes when asked ("add speaker notes").
- **Present ▾:** Present, Present with speaker notes, Present from the start. Keys as in §3.5 including `1`–`9` and `F`. Skipped slides are left out.
- **Presenter view:** a second window of the app on the same artifact and version. It shows the notes, a clock and a timer, the current and the next slide, and controls the first window through a `BroadcastChannel`. Shown only when the deck has notes.

### 6.3 Design

- All artboards sit on one canvas in a row with their names above them; pan with scroll or Space-drag, zoom as for slides. The screen list selects and centers one.
- Artboard menu: Add artboard (presets Desktop 1440×900, Tablet 834×1194, Phone 390×844, Custom), Rename, Duplicate, Resize, Delete, Move.
- Alternatives from the agent arrive as extra artboards with names like "Home · option B".
- Notes for the builder are yellow notes on an artboard (`<aside data-note>`); the agent reads them when it builds.

### 6.4 Canvas editing

- Click selects; double-click or Return edits text; Esc ends. Drag moves; handles resize; Shift keeps the ratio. Free-placed layers move by px; flow layers move by a `translate` offset. Cmd/Ctrl-drag swaps a flow layer with its neighbours and shows an insertion line. Double-click puts the caret at the pointer.
- Insert tools place a free layer on the active slide or artboard from a template in the app: text box, rectangle, rounded rectangle, oval, diamond, line, arrow, image, video, table (rows × columns, then typed cell by cell), note.
- Drop a file on the canvas: an image or a video becomes a layer at the drop point (upload first, §5.4). Other files are rejected with "Only images and videos can be dropped here."
- Group, ungroup, bring to front, send to back, flip, align (left, center, right, top, middle, bottom, distribute), duplicate, copy, cut, paste, delete, select all.
- Snapping to the canvas center, edges and sibling edges, with guide lines; `Shift+G` toggles layout guides (a 12-column overlay).
- The layers list mirrors the selection both ways.

### 6.5 Properties

Sections, in this order, each a `<details>` as in `style-inspector.tsx`:

| Section | Controls |
| --- | --- |
| Layers | Tree for the active slide or artboard |
| Position and size | X, Y, W, H, rotate; flip |
| Layout | Direction (row, column, grid), gap, padding, align, justify |
| Typography | Font (design-system fonts first), size, weight, line height, letter spacing, alignment, color |
| Appearance | Fill, opacity, radius, border style, color and width (per side behind "More") |
| Effects | Drop shadow and inner shadow (offset X and Y, blur, spread, color), layer blur, background blur |
| Advanced | Filter, backdrop, scale, skew, blend mode |
| Slide / Artboard (nothing selected) | Background, size, transition, name |

The color picker lists the design system's colors by name before the free picker, and shows "Contrast: good" or "Contrast: poor" for text against its background (WCAG AA).

Without edit rights, the same panel is read-only: it is the inspect view.

### 6.6 Comments

A comment is a thread message with an artifact reference (as annotations are today), so nothing new is stored.

- Comment mode shows a marker on every element that an unresolved reference in the thread points to, with the author's name. Clicking a marker scrolls the thread to the message.
- "Send to agent" is a checkbox on each pending comment (on by default). Checked comments go in one reply that mentions the agent. Unchecked comments are sent without a mention, so the agent's respond policy leaves them alone.
- The header button shows the open count. "Show all comments" lists them. A comment is resolved by the ✓ reaction from a human, or automatically when a later version no longer contains its target.

### 6.7 Tweaks

The agent declares controls in the document:

```json
[{ "name": "accent", "label": "Accent color", "type": "color", "var": "--accent", "value": "#3355ff" },
 { "name": "gap", "label": "Spacing", "type": "range", "var": "--gap", "min": 4, "max": 48, "step": 4, "unit": "px", "value": 16 }]
```

Types: `color`, `range`, `select`, `toggle`, `text`. Each control sets one CSS custom property on `:root`, or for `text` the content of the elements with `data-tweak="<name>"`. The app draws the controls (its own UI, not the frame's), applies changes live in the frame, and "Keep" writes the values into the source as a version. At most 24 controls; labels and options are text with the usual limits.

### 6.8 The agent in the canvas

- **Changed marks (level 2):** when a new version arrives, the panel jumps to the first changed slide or artboard and outlines the changed layers for two seconds in the agent's actor color. The rail marks changed cards. This needs only the diff of two versions.
- **Live cursor (level 4):** while the agent works, a labeled cursor sits on the element it is editing. It needs live state from the daemon, as the plan's "Agent cursor" row describes for previews; an artifact uses the same `focus: { identifier, selector }` shape.
- **Explicit mode:** the composer's "Create" menu (Slides, Design, Design system, Whiteboard, Motion) adds `dev.fabrium.artifact_hint: { type }` to the message and a plain-text line for other clients. Slash commands `/slides`, `/design`, `/design-system`, `/whiteboard`, `/motion` do the same.

### 6.9 Export and handoff

| Action | How | Level |
| --- | --- | --- |
| Web page (`.html`) | Built: the source as written. From level 3 with assets inlined. Transitions and Present keys are the app's and are not in the file. | 0 |
| PDF | A print document: one page per slide or artboard at its canvas size, skipped slides left out; the browser's print dialog saves it | 1 |
| Current slide or artboard as PNG | Asked of the agent (see below) | 5 |
| PowerPoint, Google Slides, MP4 | "Export as PowerPoint" posts a fixed request in the thread. The agent converts the artifact on its workstation and sends the file as an attachment. The tool text names what must stay editable (text, tables, pictures, backgrounds, notes) and what is dropped (transitions, skipped slides). | 5 |
| Build this | "Build this design" posts a request that names the artifact version. The agent reads the document, its notes and the design system, and builds in its workspace; a live preview follows ([`PREVIEWS_SPEC.md`](./PREVIEWS_SPEC.md)). | 5 |

### 6.10 Whiteboard (kind `whiteboard`)

One JSON document: `{ nodes: [...], edges: [...] }`.

- Nodes: `note`, `text`, `shape` (rectangle, oval, diamond), `section` (a named frame that contains nodes), `image`, `video`. Each has `id`, `x`, `y`, `w`, `h`, `text?`, `color?` (a name from a fixed list of eight, mapped to tokens), `mxc?`.
- Edges: `{ from, to, label?, arrow? }` between node ids.
- All strings are text. Nothing in a whiteboard is markup, so the board renders in the app, not in the frame.
- Editing: add, move, resize, retype, connect, group into a section, delete; pan and zoom; undo. Same version rules as §5.2.
- Agent actions in a menu: "Reorganize", "Find the gaps", and "Ask about this area" (drag a rectangle; the node ids inside go into the reply as a reference).
- Convert: "Turn into a deck" and "Turn into a document" are fixed requests to the agent.
- Export PNG: asked of the agent, as in §6.9.

### 6.11 Motion (kind `motion`)

One HTML document, one `<section>` per scene with `data-duration` (ms), animated with CSS animations or the Web Animations API only (no timers), 1920×1080 by default.

- The frame runtime pauses every animation and drives time itself (`document.getAnimations()`, `currentTime`), so seeking is exact and repeatable.
- Panel: play, pause, a scrubber with scene marks, a scene list with durations, loop.
- Editing: Tweaks for text and timing (§6.7); scene duration and order in the scene list; everything else through the agent.
- Export MP4: asked of the agent, which renders frame by frame on its workstation (§6.9).

## 7. Keyboard

We use the reference's keys so people who know it need no relearning.

| Action | Mac | Windows |
| --- | --- | --- |
| Next / previous area | `F6` / `Shift+F6` | same |
| Open or close properties | `Cmd+\` | `Ctrl+\` |
| Next / previous object | `Tab` / `Shift+Tab` | same |
| First / last object | `Home` / `End` | same |
| Enter a slide, artboard, group or text box | `Return` | `Enter` |
| Up one level | `Shift+Return` | `Shift+Enter` |
| Leave, then clear the selection | `Esc`, `Esc` | same |
| Move a free layer or an artboard | Arrows; `Shift` = 10 px | same |
| Add text / rectangle / rounded / oval / diamond | `T` / `R` / `Shift+R` / `O` / `D` | same |
| Add line / connector | `L` / `Shift+L` | same |
| Bold / italic / underline | `Cmd+B` / `I` / `U` | `Ctrl+B` / `I` / `U` |
| Duplicate | `Cmd+D` | `Ctrl+D` |
| Copy / cut / paste | `Cmd+C` / `X` / `V` | `Ctrl+C` / `X` / `V` |
| Group / ungroup | `Cmd+G` / `Cmd+Shift+G` | `Ctrl+G` / `Ctrl+Shift+G` |
| Bring to front / send to back | `]` / `[` | same |
| Flip horizontal / vertical | `Shift+H` / `Shift+V` | same |
| Select all | `Cmd+A` | `Ctrl+A` |
| Delete | `Delete` or `Backspace` | same |
| Undo / redo | `Cmd+Z` / `Cmd+Shift+Z` | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| Zoom in / out / fit | `Cmd+Plus` / `Cmd+Minus` / `Cmd+0` | `Ctrl+…` |
| Layout guides | `Shift+G` | same |
| Rail: previous / next slide | `Left` / `Right` | same |
| Rail: slide menu | `Shift+F10` | `Shift+F10` or Menu |
| Rail: delete slide | `Delete` | same |
| Present: next | `Right`, `Down`, `PageDown`, `Space` | same |
| Present: previous | `Left`, `Up`, `PageUp` | same |
| Present: first / last / jump | `Home` / `End` / `1`–`9` | same |
| Present: fullscreen / end | `F` / `Esc` | same |

Single-letter keys work only when no text is being edited and focus is on the canvas. The reference cannot place a new text layer, artboard, shape or note with the keyboard; ours places it at the center of the active frame, so it can.

## 8. Levels

| Level | Scope | Done when |
| --- | --- | --- |
| **0: modes** | Built (§2) | — |
| **1: viewer** | Read-only features of what the agent wrote: preview cards, grid view, zoom, speaker notes shown, presenter view, skipped slides honored, transitions, `1`–`9` and `F`, PDF export, e2e for Present | A 30-slide deck with notes can be reviewed and presented from two windows; axe passes in both themes |
| **2: structure** | The user writes versions (§5.2): slide and artboard menus (add, duplicate, copy, paste, move, skip, delete, rename), notes editing, design-system values edited and added on the page, undo/redo, Restore, Duplicate artifact, changed marks | e2e: the user reorders and skips slides, the agent then edits slide 2 with `edits` and the result contains both changes |
| **3: canvas** | Edit pipeline (§5.3), selection, layers list, move, resize, retype, insert tools, drop files, assets (§5.4), group, order, align, snapping, the full properties panel, all-artboards canvas, floating toolbar, keyboard table | e2e: insert a text box and an image, restyle them, reload, and the version holds them; a malicious frame cannot write markup into a version (unit test on the op validator) |
| **4: working with the agent** | Mode picker and slash commands, tool text for questions, variations and placeholders, persistent comments, tweaks, design systems across threads (§5.6) with themes, fonts, icons, repo sync and the composer chip, live agent cursor | A deck made in a new thread uses the workspace's default design system without being told |
| **5: more modes and export** | Whiteboard, motion, PowerPoint / Google Slides / PNG / MP4 through the agent, "Build this", templates, drawing on the canvas | Each new kind has its viewer, stories and an e2e; a `.pptx` made by the agent opens with editable text |

Levels 1 and 2 need no change to the preview frame's trust model; the PDF export's short-lived print frame alone adds `allow-modals` (§12). Level 3 is the largest and should be split by tool when it is planned.

## 9. To-dos

### 9.1 Web UI (`packages/web`)

Level 1:

- [x] `lib/artifacts/frames.ts`: read notes, `data-skip` and `data-transition` from the inert source instead of the frame's report.
- [x] `components/artifacts/frame-card.tsx` (preview card, §5.5) with a story; use it in `frame-rail.tsx`.
- [x] Grid view in `artifact-panel.tsx`; zoom steps and keys for slides.
- [x] Notes area under the slide (read-only); presenter route and `BroadcastChannel` sync; Present menu.
- [x] Transitions in `framesRuntime` (`srcdoc.ts`), off under `prefers-reduced-motion`.
- [x] PDF: a print document built from the same srcdoc with one page per frame.
- [x] e2e: Present and presenter view; axe for the grid view.
- [x] Carried over from the plan: a shadow root per design-system component, so unbalanced markup cannot break the section page; a message instead of a blank Preview for an empty design system (`{}`); frames that a script adds after load are not listed (accept, and say so in the tool text).

Level 2:

- [x] `lib/artifacts/edit.ts`: pure operations on the inert source for sections and notes, and on design-system JSON; unit tests.
- [x] Send a version from the client (`client/` + `events/fabrium-artifact.ts`: `based_on`, `summary`); debounce, flush, undo stack.
- [x] Decide and enforce who may author a version (D2). The decoder has no sender rule today.
- [x] Slide and artboard menus, drag to reorder, clipboard; "Made from an older version" notice; Restore and Duplicate in the title menu.
- [x] Design-system page: edit and add in place (the Add form writes instead of annotating; annotation stays for users without edit rights).
- [x] Changed marks from the diff of two versions. The changed slide or artboard is outlined; outlines per layer need the element ids of level 3.
- [x] A user's saves fold into the current version (§5.2): no version number, no card in the thread; the version list shows who edited it.
- [x] Layout picker for Add slide (`layout-picker.tsx`); `<template data-layout>` reader and fallbacks in `edit.ts`.

Level 3:

- [x] Stamp and strip `data-fab-id`; op messages in `PreviewMessage`; op validator with tests.
- [x] Editor runtime in the hook script: selection box, handles, drag, text editing, snapping. (The file drop target comes with assets.)
- [x] `components/artifacts/canvas-toolbar.tsx`, `layers-list.tsx`, floating toolbar; stories.
- [x] Extend `style-inspector.tsx` and `styles.ts` to the sections in §6.5; color picker with design-system colors and contrast.
- [x] Assets: upload, `mxc` resolution, bytes into the frame, CSP `font-src blob:`, inlining on download; Image and Video tools, file drop on the canvas.
- [x] All-artboards canvas with pan and zoom.
- [x] Mobile sheet for properties.

Level 4:

- [ ] Composer "Create" menu, slash commands, `dev.fabrium.artifact_hint`.
- [ ] Comment markers, list, open count, "Send to agent", resolve.
- [ ] Tweaks reader (untrusted JSON) and panel; "Keep".
- [ ] `dev.fabrium.design_systems` decoder, settings page for workspace owners, composer chip, design-system reader for `themes`, `fonts`, `icons`, `logos`, `layout`.
- [ ] Agent cursor overlay.

Level 5:

- [ ] `whiteboard` reader and board editor; `motion` runtime and transport bar; kinds in `model/types.ts`, card, panel.
- [ ] Export menu entries that post fixed requests; "Build this".

### 9.2 Daemon (`packages/core`, `packages/context-mcp`, `packages/transport-matrix`, `packages/pi-extension`)

- [x] L1: tool text for `<aside data-notes>`, `data-skip`, `data-transition`.
- [x] L2: `latestArtifact` resolves the newest version from any allowed author; `zooid_artifact` `read`; the "user edited" line in the next turn; `based_on` on agent versions; `started_ts` on `dev.zooid.turn.end`; tool text for `<template data-layout>`.
- [x] L3: `assets` input on `zooid_artifact`; tool text for `data-layer`, `data-free`, `data-lock`, `data-note`.
- [ ] L4: `zooid_design_system` tool; tool text for questions, variations, placeholders, tweaks and the conformance check; honor `dev.fabrium.artifact_hint`; `focus` live state for the cursor; confirm that thread attachments reach the agent, and add it if not.
- [ ] L5: kinds `whiteboard` and `motion` with validation; tool text for the export and build requests; render tooling on the agent VM image (headless browser, `ffmpeg`, a PPTX writer) — each needs `package-vetting`.

## 10. Open decisions

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Document model for slides and design: stay HTML, or move to a JSON scene graph | Stay HTML (§4.1). A scene graph makes canvas editing easier but loses free-form agent output, the download, and the Code tab's meaning. Revisit only if level 3's op model proves too weak. |
| D2 | Who may write a version by hand | Any human member who can send messages in the room. Guests cannot. An agent other than the author can, through its own tool. |
| D3 | Direct edits of `html` artifacts | Style and text only. No structure tools outside `slides` and `design`. |
| D4 | Scripts in `slides` and `design` | Allowed (prototypes need them). Script-made elements are not editable by hand. |
| D5 | Thumbnails | Lazy frames (§5.5). A raster path needs a new dependency and runs inside the frame. |
| D6 | Comments storage | Thread messages with references (§6.6), not a new event. Resolve by reaction. |
| D7 | Where a design system lives | An artifact in a room, listed by a state event (§5.6). Alternative: files in a repo, which only helps agents with that repo. |
| D8 | PowerPoint and MP4 | Through the agent (§6.9), not in the browser. In-browser needs large new dependencies. |
| D9 | Whiteboard rendering | In the app, because a board holds no markup (§6.10). Needs design sign-off for the eight note colors. |
| D10 | Live cursor transport | Reuse the previews `focus` state from the plan; do not add ephemeral Matrix events. |
| D11 | Name in the UI | "Design modes" is the working name of this spec only. The UI says Slides, Design, Design system, Whiteboard, Motion. |

## 11. Out of scope

- Live co-editing with remote cursors, presence on thumbnails, follow mode. Versions are atomic; two people editing at once get two versions and the notice in §5.2.
- Share links and access levels outside the room, publishing to a public URL (see the previews backlog, "Publish").
- "Send to" partner tools, connectors, web capture from a live site.
- Dictation and microphone input.
- Admin toggles per template, plan limits, usage accounting.
- Docs, Sheets and Data templates.
- Image generation. An agent can attach images it has; it does not make photos.

## 12. Security summary

- Agent markup (slides, designs, components, assets) renders only in the sandboxed frame without `allow-same-origin` and without network. This does not change at any level. The PDF export's print frame, which exists only from the Export click until the print dialog closes, also has `allow-modals` (`print()` needs it); no other frame does.
- From level 2, users write versions. The app serializes only its own inert copy of the source after validated operations (§5.3). The frame can ask for a move, a number or a text; it cannot hand over markup, attribute names outside the allow-list, or CSS that fails `cssValue`.
- Agent scripts run in the same frame as the editor, so the app takes ops and keys from the frame only during the user's transient activation or a few seconds after it (a long drag). A script cannot edit, delete or paste while the user is idle; during that window it can still send ops or keys of its own, which then save as the user's edit.
- Files dropped on the canvas go to a drop target on the stage, outside the frame; the frame swallows file drags and never sees the file.
- Pasted slides and clipboard content are markup from outside: they are parsed inert, stored as source, and run only in the frame.
- Assets come through authenticated media and enter the frame as bytes. Sizes and counts are capped (§5.4). SVG is an image, never inlined by the app.
- Tweaks, whiteboards, design-system JSON and every frame message are untrusted input with readers that clamp and drop.
- Version authorship is the Matrix sender. The card and the version list show the author with the actor marker, so a user's edit never reads as the agent's.
- Encrypted rooms: artifacts are ignored there today; this spec does not change that.
