import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { TaskActions, TransportContextProvider } from '@zooid/core'
import { buildContextMcpServer } from './mcp-server.js'
import {
  AGENT_NOTIFY_INSTRUCTIONS,
  ARTIFACT_DESCRIPTION,
  ARTIFACT_INSTRUCTIONS,
  DESIGN_SYSTEM_DESCRIPTION,
  HANDOFF_DESCRIPTION,
  PREVIEW_FOCUS_DESCRIPTION,
  SEND_MESSAGE_DESCRIPTION,
} from './index.js'

const provider = {} as TransportContextProvider
const tasks: TaskActions = {
  startTasks: async () => ({ results: [] }),
  completeTask: async () => ({ status: 'recorded' }),
  describeRole: async () => ({ is_task_assignee: false, can_start_task_threads: true, can_handoff: true }),
  handoff: async () => ({ status: 'refused', reason: 'stub' }),
} as unknown as TaskActions

async function connect() {
  const server = buildContextMcpServer({
    resolve: async () => provider,
    resolveTasks: async () => tasks,
    role: { is_task_assignee: false, can_start_task_threads: true, can_handoff: true },
  })
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} })
  await Promise.all([server.connect(serverT), client.connect(clientT)])
  return client
}

describe('shared tool text ([[ZOD094]])', () => {
  it('is exported from the package entry point with the 0.16 wording', () => {
    // Pinning the key phrases, not the whole string: the point of the module
    // is that there is exactly one copy, which the adapters import.
    expect(HANDOFF_DESCRIPTION).toMatch(/only way to involve another agent/i)
    expect(HANDOFF_DESCRIPTION).toMatch(/\[handoff return\] from <agent>/)
    expect(HANDOFF_DESCRIPTION).toMatch(/zooid_start_task_threads/)
    expect(AGENT_NOTIFY_INSTRUCTIONS).toMatch(/zooid_handoff/)
    expect(AGENT_NOTIFY_INSTRUCTIONS).toMatch(/do not notify agents/i)
    expect(SEND_MESSAGE_DESCRIPTION).toMatch(/zooid_handoff/)
    expect(SEND_MESSAGE_DESCRIPTION).toMatch(/do not notify agents/i)
    expect(ARTIFACT_DESCRIPTION).toMatch(/<aside data-notes>/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/data-skip/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/data-transition="fade" or "slide"/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/sections a script adds at run time are not listed/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/Every new deck also gets ten layouts in <head>: one <template data-layout="NAME">/)
    expect(ARTIFACT_DESCRIPTION).toMatch(
      /blank, title, section, title-body, bullets, two-columns, table, quote, image-caption \(a placeholder box, not an image\) and closing/,
    )
    expect(ARTIFACT_DESCRIPTION).toMatch(/They are not slides and are not shown; the user adds slides from them\. When you restyle the deck, restyle the templates too\./)
    expect(ARTIFACT_DESCRIPTION).toMatch(/The user may have edited the artifact/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/`edits` apply to the latest version from any author/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/pass only `identifier` and `read: true`/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/data-layer="Name" names an element in the layers list/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/data-free places an element freely \(position: absolute with left, top, width and height in px/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/data-lock keeps a layout element from being selected by hand/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/<aside data-note> in a section \(not data-notes\).*read the notes when you build or change the artifact/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/pass only `identifier` and `assets`.*each path mapped to an mxc:\/\/ URI/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/src on <img>, <video> or <source>, or in url\(\) in @font-face/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/When you were told "The user edited artifact `<identifier>`".*call `read` before you change it, with `edits` or with a full `content` rewrite/)
  })

  it('teaches tweaks, questions, placeholders and variations (design modes level 4)', () => {
    expect(ARTIFACT_DESCRIPTION).toMatch(/up to 24 controls in <head> as <script type="application\/json" data-tweaks>/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/"color" \(value "#rrggbb"\), "range" \(min, max, step, unit/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/declare it in a :root rule with the same value as the JSON/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/Type "text" \(no var\) sets the text of the elements with data-tweak="<name>"/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/When the turn says "The user chose <type> in the composer", use that type/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/first ask two or three clarifying questions or propose an outline/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/put a visible placeholder in the artifact, e\.g\. "\[Q3 revenue: to confirm\]"/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/add each one as an extra section \(slide or artboard\) right after it, with the same name plus " · option B"/)
  })

  it('teaches design systems across threads (design modes spec §5.6)', () => {
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/Before you write a new slides, design or motion artifact, call zooid_design_system without arguments/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/default for that kind \(`default_for`\)/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/copy its `css` as it is into the artifact's own <style>/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/var\(--color-<name>\)/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/read a token's or component's `description` before you use it/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/Before you send, check your output against the tokens/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/themes \(list of \{name, colors\}.*fonts \(list of \{name, mxc, weight\?, style\?\}.*layout \(list of \{name, value, description\?\}/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/icons, logos and assets \(each a list of \{name, svg\}\)/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/Give every color and component a `description`/)
    expect(DESIGN_SYSTEM_DESCRIPTION).toMatch(/Without arguments it returns `systems`/)
    expect(DESIGN_SYSTEM_DESCRIPTION).toMatch(/`css` \(every token as a CSS variable in one :root rule, plus a \[data-theme="<name>"\] rule per theme\)/)
    expect(DESIGN_SYSTEM_DESCRIPTION).toMatch(/Add `component` \(a name\) to get that component's html/)
  })

  it('teaches whiteboard, motion, export and build (design modes level 5)', () => {
    expect(ARTIFACT_DESCRIPTION).toMatch(/"whiteboard": one JSON object \{"nodes": \[\.\.\.\], "edges": \[\.\.\.\]\} and nothing else; every string is plain text, never markup/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/type "note", "text", "shape", "section", "image" or "video"/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/a node belongs to it when the node's center lies inside the section's box/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/At most 500 nodes and 1000 edges/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/An edge is \{from, to, label\?, arrow\?, style\?, color\?\}/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/style "solid" \(default\), "dashed" or "dotted", color one of the node colors/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/"motion": one HTML document; each scene is a <section> .* data-duration in ms \(100 to 600000; 3000 when missing\)/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/optional data-name naming the scene \(else its first heading\)/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/never setTimeout, setInterval or requestAnimationFrame/)
    expect(ARTIFACT_DESCRIPTION).toMatch(/"range" tweaks bound to a CSS variable .* expose timing/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/sticky notes, mind map or board of boxes and arrows is "whiteboard"; an animation, motion graphic/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/convert it on your workstation, and send the file with zooid_send_attachment in the thread/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/Keep editable: text as real text boxes .* tables as real tables; images as pictures; slide backgrounds; speaker notes from <aside data-notes>/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/skipped sections \(data-skip\) left out/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/Leave out transitions/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/Google Slides: the same \.pptx, with every font replaced by a basic one .*Do not call any Google API/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/PNG: a screenshot of the section the request names .* or of the whole whiteboard/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/MP4 \(motion\): render frame by frame.*set its currentTime.*ffmpeg/)
    expect(ARTIFACT_INSTRUCTIONS).toMatch(/"Build this" names a design version: read it, read every <aside data-note> in it \(builder notes\), and read the design system/)
  })

  it('is exactly what the MCP server serves', async () => {
    const client = await connect()
    const tools = (await client.listTools()).tools
    expect(tools.find((t) => t.name === 'zooid_handoff')?.description).toBe(HANDOFF_DESCRIPTION)
    expect(tools.find((t) => t.name === 'zooid_send_message')?.description).toBe(SEND_MESSAGE_DESCRIPTION)
    expect(client.getInstructions()).toBe(`${AGENT_NOTIFY_INSTRUCTIONS}\n\n${ARTIFACT_INSTRUCTIONS}`)
    expect(tools.find((t) => t.name === 'zooid_artifact')?.description).toBe(ARTIFACT_DESCRIPTION)
    expect(tools.find((t) => t.name === 'zooid_design_system')?.description).toBe(DESIGN_SYSTEM_DESCRIPTION)
  })

  it('names the cursor tool for artifacts and previews (DESIGN_MODES_SPEC.md §6.8)', async () => {
    expect(PREVIEW_FOCUS_DESCRIPTION).toMatch(/artifact \(pass its `identifier`\) or of a preview page \(pass the preview `name` and the page `path`\)/)
    expect(PREVIEW_FOCUS_DESCRIPTION).toMatch(/cleared when your turn ends/)
    const server = buildContextMcpServer({ resolve: async () => provider, callPreview: async (method, params) => ({ method, params }) })
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} })
    await Promise.all([server.connect(serverT), client.connect(clientT)])
    const tools = (await client.listTools()).tools
    expect(tools.find((t) => t.name === 'zooid_preview_focus')?.description).toBe(PREVIEW_FOCUS_DESCRIPTION)
    const out = await client.callTool({ name: 'zooid_preview_focus', arguments: { identifier: 'deck', selector: 'h1' } })
    expect(JSON.parse((out.content as Array<{ text: string }>)[0]!.text)).toEqual({
      method: 'previewFocus',
      params: { identifier: 'deck', selector: 'h1' },
    })
  })
})
