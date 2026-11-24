import type { ArtifactKind } from '@zooid/core'

/**
 * Model-facing text shared by every Zooid tool surface — the MCP server here
 * and the native pi extension ([[ZOD080]]). One copy, so both runtimes teach
 * the model the same handoff contract ([[ZOD092]] §7, [[ZOD094]]).
 * No imports: this module is inlined into the pi bundle.
 */

/** MCP server `instructions`; on pi, a promptGuidelines bullet on zooid_handoff. */
export const AGENT_NOTIFY_INSTRUCTIONS =
  'To involve another agent in this thread, call zooid_handoff. @mentions in your messages notify humans; they do not notify agents.'

export const HANDOFF_DESCRIPTION =
  'Hand work to one other agent in THIS thread — the only way to involve another agent here. @mentions in messages do not notify agents. Name the agent by name (or workstation.agent); the daemon resolves it. After a successful handoff, end your turn: the result comes back to you as `[handoff return] from <agent>`. For several agents in parallel, use zooid_start_task_threads instead.'

export const SEND_ATTACHMENT_DESCRIPTION =
  "Attach a file to the current thread, posted as you: an image shows inline, anything else as a downloadable file. Write the file first, then pass its path (relative to your workspace, or absolute). Optional `name` sets the filename shown; optional `caption` is posted right after it. Returns the event_id and mxc_uri. Only the current thread; you can't pick a room."

export const SEND_MESSAGE_DESCRIPTION =
  'Post a message into a room or thread this agent is bound to. Fire-and-forget: no assignee, no completion tracking, no notify. @mentions in it notify humans; they do not notify agents. To involve another agent use zooid_handoff (this thread) or zooid_start_task_threads (parallel, new threads).'

/**
 * The artifact contract. Previews run sandboxed with no network, the same
 * limits as Haven's artifacts, so the model is told what works.
 */
export const ARTIFACT_DESCRIPTION =
  'Show content to the user in the side panel of the chat, with live preview and version history. The user cannot see files in your workspace; this is how they see what you made. ' +
  'Types: "html" (complete self-contained page, inline CSS/JS), "svg", "react" (one component with `export default`; React hooks are globals, Tailwind classes work, no other libraries), "markdown" (a document), "code" (set `language`; shown, not run). ' +
  '"slides": one HTML document; each slide is a <section> that is a direct child of <body>, a 1920x1080 px canvas sized in px; shared CSS in one <style> in <head>; optional data-title names a slide; speaker notes go in an <aside data-notes> inside the slide (plain text, never shown on it); data-transition="fade" or "slide" on <body> or a section animates Present; data-size="4:3" on <body> makes every slide 1440x1080 px, set by you or by the user: keep it and lay the slides out for that size. ' +
  'Every new deck also gets ten layouts in <head>: one <template data-layout="NAME"> each, holding one <section> in the deck\'s own design (same classes, fonts, colors, spacing) with short placeholder text, NAME being blank, title, section, title-body, bullets, two-columns, table, quote, image-caption (a placeholder box, not an image) and closing. They are not slides and are not shown; the user adds slides from them. When you restyle the deck, restyle the templates too. ' +
  '"design": one HTML document; each screen is a <section> that is a direct child of <body>, with data-name (e.g. "Home") and optional data-width and data-height in px (default 1440x900, phone 390x844). ' +
  'In both, data-skip on a section leaves it out of Present and the PDF export; sections a script adds at run time are not listed. ' +
  'Also in both: data-layer="Name" names an element in the layers list; data-free places an element freely (position: absolute with left, top, width and height in px; the user moves and resizes it there), other elements stay in flow; data-lock keeps a layout element from being selected by hand. An <aside data-note> in a section (not data-notes) is the user\'s note for you, shown on the canvas, never in Present or exports: read the notes when you build or change the artifact. ' +
  'Tweaks (slides, design, html): when some values matter to the user (accent color, spacing, type size, timing), declare up to 24 controls in <head> as <script type="application/json" data-tweaks> holding a JSON list of {name, label, type, var, value}. Types "color" (value "#rrggbb"), "range" (min, max, step, unit such as "px", a number value), "select" (options: list of {label, value}) and "toggle" (on and off CSS values, a boolean value) set the CSS custom property `var` (e.g. "--accent") on :root: declare it in a :root rule with the same value as the JSON and use var(--accent) in your CSS. Type "text" (no var) sets the text of the elements with data-tweak="<name>". The user changes them in a Tweaks panel; when they keep the values, the JSON, the :root rule and the text are rewritten as their edit. ' +
  '"design-system": one JSON object with any of: overview (markdown), colors, spacing, typography, radius, shadows (each a list of {name, value, description?}; token names kebab-case; a typography value is a CSS font shorthand, e.g. "600 32px/1.2 Inter, sans-serif"), themes (list of {name, colors}: per theme, e.g. "light" and "dark", the colors whose values differ), fonts (list of {name, mxc, weight?, style?}: font files uploaded with `assets`), layout (list of {name, value, description?}: grids and page structures in words), components (list of {name, description?, html}), icons, logos and assets (each a list of {name, svg}). Give every color and component a `description`: the usage note other agents read before they use it. Component html may use the tokens as CSS variables --color-<name>, --spacing-<name>, --font-<name>, --radius-<name>, --shadow-<name>. ' +
  'Previews have NO network: no fetch, CDN scripts, web fonts or remote images; no localStorage, cookies, alert, popups. Inline everything; use sample data. ' +
  'For images, video or fonts in your workspace, first pass only `identifier` and `assets` (their paths: png, jpg, gif, webp, avif, svg up to 10 MB; mp4, webm up to 50 MB; woff2, woff, ttf, otf up to 2 MB; 100 per artifact); it uploads them, sends nothing and returns `assets`, each path mapped to an mxc:// URI. Use that URI as src on <img>, <video> or <source>, or in url() in @font-face; the preview loads it. ' +
  'To create or fully rewrite, pass `content`. To change an artifact in this thread, keep the SAME identifier and pass `edits` (find/replace pairs; each old_str copied verbatim from the latest version and unique in it) for small changes, or the full `content` for large ones. ' +
  'The user may have edited the artifact since your last version: `edits` apply to the latest version from any author, yours or theirs. To read the latest version, pass only `identifier` and `read: true`; it returns its `content`, `event_id` and `sender` and sends nothing. When you were told "The user edited artifact `<identifier>`", or an edit fails with old_str not found, call `read` before you change it, with `edits` or with a full `content` rewrite, and build on what it returns, so your change keeps theirs. ' +
  'Users can annotate parts of an artifact; their message then lists each annotation with the artifact identifier, version, the selected element or text, and their note. Under ~500 KB.'

/**
 * When to reach for zooid_artifact. MCP server `instructions` (always in the
 * system prompt, even while a client defers loading the tool itself); on pi, a
 * promptGuidelines bullet on zooid_artifact.
 */
export const ARTIFACT_INSTRUCTIONS =
  'The user reads you in a chat that shows artifacts in a side panel with a live preview; files you write in your workspace are invisible to them. ' +
  'Call zooid_artifact without being asked whenever your answer includes: a working web page, UI component or interactive prototype (html or react); a presentation (slides); a visual design (design); a design system (design-system); an SVG image, chart or diagram; a document over ~20 lines such as a plan, spec, report, README, proposal or email draft (markdown); or a complete file or script the user should read or reuse (code). ' +
  'Pick the type from the request: a presentation, deck, pitch or slides is "slides"; a visual design, mockup, wireframe, screen, landing page or app UI design is "design"; a design system, style guide, brand guidelines or design tokens is "design-system"; a working page or interactive prototype stays "html" or "react". ' +
  'When the turn says "The user chose <type> in the composer", use that type. ' +
  'For a slides, design or design-system request that is short or leaves out the audience, content or style, first ask two or three clarifying questions or propose an outline in your message, and build after the answer; build at once when the request says enough or the user asks you to go ahead. ' +
  'Never invent facts, figures, names or quotes: where one is missing, put a visible placeholder in the artifact, e.g. "[Q3 revenue: to confirm]", and list the placeholders in your message. ' +
  'When asked for variations or alternatives, keep the original and add each one as an extra section (slide or artboard) right after it, with the same name plus " · option B", " · option C"; in a design system, add alternative tokens or components with the same suffix. ' +
  'Before you write a new slides or design artifact, call zooid_design_system without arguments and read the system that is the default for that kind (`default_for`) with zooid_design_system `{ identifier }`, unless the user named another or the turn says which one to use or that design systems are off; none listed means none applies. Apply it: copy its `css` as it is into the artifact\'s own <style> (the artifact keeps the system as it was when you made it), take every color, font, spacing, radius and shadow from those variables (var(--color-<name>) and so on), load its fonts with @font-face from their mxc URIs, and read a token\'s or component\'s `description` before you use it (`component` returns its html). Before you send, check your output against the tokens: replace any literal color, font, size, radius or shadow that is not the system\'s with its variable, or tell the user why the system lacks it. ' +
  'Also call it when you create or change such a file on disk and the user should look at it. ' +
  'When the user asks to change something you showed as an artifact, update the same identifier; changing one slide, screen or token is an `edits` call on it. ' +
  'Keep the chat message short: say what you made, do not repeat the artifact content in it. Short answers, explanations and snippets under ~15 lines stay in the message.'

// A local value, not core's ARTIFACT_KINDS: the bin must stay free of @zooid/core
// at runtime (tsup.config.ts). The Record fails to compile if the kinds drift.
const KINDS: Record<ArtifactKind, true> = {
  html: true,
  svg: true,
  react: true,
  markdown: true,
  code: true,
  slides: true,
  design: true,
  'design-system': true,
}
/** The artifact kinds, for the MCP and pi tool schemas. */
export const ARTIFACT_KINDS = Object.keys(KINDS) as [ArtifactKind, ...ArtifactKind[]]

export const DESIGN_SYSTEM_DESCRIPTION =
  'List the design systems the workspace and this room\'s project use, or read one. It reads; it changes nothing. ' +
  'Without arguments it returns `systems`, each {identifier, name, room_id, thread_id, default?, for?, default_for?}: `for` limits a system to some kinds, `default_for` names the kinds ("slides", "design") it is the default for. ' +
  'With `identifier` (and `room_id` when two share one) it returns that system: `overview`, `css` (every token as a CSS variable in one :root rule, plus a [data-theme="<name>"] rule per theme), `tokens` per section with each token\'s `var`, `value` and `description` (its usage note), `themes`, `fonts` ({name, mxc, weight?, style?}), `layout` patterns, `components` ({name, description}) and the names of its icons, logos and assets. Add `component` (a name) to get that component\'s html.'

export const PREVIEW_START_DESCRIPTION =
  'Run a web app and show it live to the user beside this thread: use it for anything with a dev server (Vite, Next.js, Flask, Rails, a static file server). For a single self-contained page or component, use zooid_artifact instead. ' +
  'Pass the shell command that starts the app in the foreground (e.g. "npm run dev -- --port $PORT"). It runs in your workspace (or `cwd`), keeps running after your turn, and is restarted when you call this again with the same `name`. ' +
  'The app MUST listen on the port in $PORT (or the `port` you pass) on 127.0.0.1 or localhost; it gets a clean environment (PATH, HOME, LANG and PORT, no daemon secrets), so pass anything else in `env` (not PATH, HOME, PORT or loader variables). `cwd` must be inside your workdir. Install dependencies before calling. ' +
  'Returns once the port accepts connections (status "running") or the app exits or 60 s pass, with the last log lines: if the status is "crashed" or still "starting", read the logs, fix the problem, and call again. ' +
  'The user sees the app in a card in this thread; do not post its URL. Only in threads. ' +
  'For an Expo app pass kind "expo" and the command "npx expo start --port $PORT"; never add --tunnel or --lan, the preview is the tunnel. ' +
  'Expo Go runs only the SDK version it ships with and no custom native code: if the logs report an SDK mismatch, move the project to the SDK Expo Go supports or tell the user.'

export const PREVIEW_STOP_DESCRIPTION = 'Stop a preview app you started with zooid_preview_start.'

export const PREVIEW_LOGS_DESCRIPTION =
  'Read the latest output (stdout and stderr) of a preview app you started, with its status. Use it when the user reports a problem in the preview.'

export const PREVIEW_FOCUS_DESCRIPTION =
  'Show the user where you are working: a labeled cursor on one element of an artifact (pass its `identifier`) or of a preview page (pass the preview `name` and the page `path`). ' +
  'Pass one CSS selector for the element, on one line (at most 300 characters), e.g. "section:nth-of-type(3) h1". Call it before you change that part, and again when you move on; it is cleared when your turn ends, or call it without `selector` to clear it sooner. ' +
  'It changes nothing in the artifact or the app.'
