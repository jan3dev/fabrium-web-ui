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
  'Previews have NO network: no fetch, CDN scripts, web fonts or remote images; no localStorage, cookies, alert, popups. Inline everything; use sample data. ' +
  'To create or fully rewrite, pass `content`. To change an artifact you created earlier in this thread, keep the SAME identifier and pass `edits` (find/replace pairs; each old_str copied verbatim from the latest version and unique in it) for small changes, or the full `content` for large ones. ' +
  'Users can annotate parts of an artifact; their message then lists each annotation with the artifact identifier, version, the selected element or text, and their note. Under ~500 KB.'

/**
 * When to reach for zooid_artifact. MCP server `instructions` (always in the
 * system prompt, even while a client defers loading the tool itself); on pi, a
 * promptGuidelines bullet on zooid_artifact.
 */
export const ARTIFACT_INSTRUCTIONS =
  'The user reads you in a chat that shows artifacts in a side panel with a live preview; files you write in your workspace are invisible to them. ' +
  'Call zooid_artifact without being asked whenever your answer includes: a web page, UI component, mockup or prototype (html or react); an SVG image, chart or diagram; a document over ~20 lines such as a plan, spec, report, README, proposal or email draft (markdown); or a complete file or script the user should read or reuse (code). ' +
  'Also call it when you create or change such a file on disk and the user should look at it. ' +
  'When the user asks to change something you showed as an artifact, update the same identifier. ' +
  'Keep the chat message short: say what you made, do not repeat the artifact content in it. Short answers, explanations and snippets under ~15 lines stay in the message.'

// A local value, not core's ARTIFACT_KINDS: the bin must stay free of @zooid/core
// at runtime (tsup.config.ts). The Record fails to compile if the kinds drift.
const KINDS: Record<ArtifactKind, true> = { html: true, svg: true, react: true, markdown: true, code: true }
/** The artifact kinds, for the MCP and pi tool schemas. */
export const ARTIFACT_KINDS = Object.keys(KINDS) as [ArtifactKind, ...ArtifactKind[]]
