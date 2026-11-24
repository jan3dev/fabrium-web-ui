import { describe, expect, it, vi } from 'vitest'
import { MatrixContextProvider } from './context-provider.js'
import {
  designSystemChoiceLine,
  mergeDesignSystemLists,
  parseDesignSystemList,
  readDesignSystem,
} from './design-systems.js'
import type { MatrixClient } from './matrix-client.js'

const entry = (identifier: string, extra: Record<string, unknown> = {}) => ({
  room_id: '!design:hs',
  thread_id: '$thread',
  identifier,
  name: identifier.toUpperCase(),
  ...extra,
})

describe('parseDesignSystemList', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parseDesignSystemList({
        systems: [
          entry('brand', { default: true, for: ['slides', 'whiteboard', 'motion'] }),
          { ...entry('a'), room_id: '!with`tick' },
          { ...entry('b'), thread_id: undefined },
          { ...entry('c'), identifier: 'has space' },
          entry('plain', { name: ' ‮X\ny ', default: 'yes' }),
          7,
        ],
      }),
    ).toEqual([
      { room_id: '!design:hs', thread_id: '$thread', identifier: 'brand', name: 'BRAND', default: true, for: ['slides', 'motion'] },
      { room_id: '!design:hs', thread_id: '$thread', identifier: 'plain', name: 'X y' },
    ])
    expect(parseDesignSystemList(undefined)).toEqual([])
  })

  it('merges project lists first and marks the default per kind', () => {
    const project = parseDesignSystemList({ systems: [entry('deck', { default: true, for: ['slides'] })] })
    const workspace = parseDesignSystemList({ systems: [entry('brand', { default: true }), entry('deck')] })
    expect(mergeDesignSystemLists([project, workspace])).toEqual([
      { ...project[0], default_for: ['slides'] },
      { ...workspace[0], default_for: ['design', 'motion'] },
    ])
  })
})

const SYSTEM = {
  overview: '# Brand',
  colors: [{ name: 'Brand Blue', value: '#3355ff', description: 'Primary actions only' }, { name: 'evil', value: 'red;} body{x:y' }],
  spacing: [{ name: 'sm', value: '8px' }, { name: 'open', value: 'calc(8px' }],
  typography: [{ name: 'h1', value: '600 32px/1.2 Inter, sans-serif' }],
  themes: [{ name: 'Dark', colors: [{ name: 'brand-blue', value: '#99aaff' }] }],
  fonts: [{ name: 'Inter', mxc: 'mxc://hs/abc', weight: 600 }, { name: 'Bad', mxc: 'https://x' }],
  layout: [{ name: 'Grid', value: '12 columns' }],
  components: [{ name: 'Button', description: 'One per screen', html: '<button>Go</button>' }],
  icons: [{ name: 'Arrow', svg: '<svg/>' }],
}

describe('readDesignSystem', () => {
  it('returns the CSS variables, tokens and component list, without markup', () => {
    const read = readDesignSystem(JSON.stringify(SYSTEM))
    expect(read.css).toBe(
      ':root {\n  --color-brand-blue: #3355ff;\n  --spacing-sm: 8px;\n  --font-h1: 600 32px/1.2 Inter, sans-serif;\n}\n' +
        '[data-theme="dark"] {\n  --color-brand-blue: #99aaff;\n}',
    )
    expect((read.tokens as Record<string, unknown[]>).colors).toEqual([
      { name: 'brand-blue', var: '--color-brand-blue', value: '#3355ff', description: 'Primary actions only' },
    ])
    expect(read.fonts).toEqual([{ name: 'Inter', mxc: 'mxc://hs/abc', weight: '600' }])
    expect(read.components).toEqual([{ name: 'Button', description: 'One per screen' }])
    expect(read.icons).toEqual(['Arrow'])
    expect(read.layout).toEqual([{ name: 'Grid', value: '12 columns' }])
  })

  it('returns one component on request', () => {
    expect(readDesignSystem(JSON.stringify(SYSTEM), 'button')).toEqual({
      component: { name: 'Button', description: 'One per screen', html: '<button>Go</button>' },
    })
    expect(() => readDesignSystem(JSON.stringify(SYSTEM), 'Card')).toThrow(/not_found: no component "Card". Components: Button/)
    expect(() => readDesignSystem('[]')).toThrow(/invalid_content/)
  })
})

describe('designSystemChoiceLine', () => {
  it('names the sender’s own system, or off', () => {
    expect(designSystemChoiceLine({ 'dev.fabrium.design_system': { room_id: '!r:hs', identifier: 'brand' } })).toBe(
      "The user's own design system is `brand` (room !r:hs): use it instead of the default; read it with zooid_design_system.",
    )
    expect(designSystemChoiceLine({ 'dev.fabrium.design_system': { off: true } })).toMatch(/turned design systems off/)
    expect(designSystemChoiceLine({ 'dev.fabrium.design_system': { room_id: '!r', identifier: 'a`b' } })).toBeNull()
    expect(designSystemChoiceLine({ body: 'hi' })).toBeNull()
  })
})

describe('MatrixContextProvider.designSystem', () => {
  const AGENT = '@ws.agent:hs'
  function provider(state: Record<string, unknown[]>) {
    const client = {
      fetchRoomState: vi.fn(async (roomId: string) => {
        if (!state[roomId]) throw new Error('403')
        return state[roomId]
      }),
      fetchStateContent: vi.fn(async (roomId: string, type: string) => {
        if (!state[roomId]) throw new Error('403')
        return (state[roomId] as Array<{ type: string; content: unknown }>).find((e) => e.type === type)?.content ?? null
      }),
      resolveAlias: vi.fn(async (alias: string) => (alias === '#dev:hs' ? '!workspace:hs' : null)),
      getJoinedMembers: vi.fn(async () => ({ joined: {} })),
      fetchThreadRelations: vi.fn(async () => ({
        chunk: [
          {
            event_id: '$v1',
            sender: AGENT,
            content: { identifier: 'brand', type: 'design-system', title: 'Brand', body: JSON.stringify(SYSTEM) },
          },
        ],
      })),
    }
    const p = new MatrixContextProvider({
      client: client as unknown as MatrixClient,
      asUserId: AGENT,
      agentBots: new Map(),
      workspaceSpace: 'dev',
    })
    return { p, client }
  }
  const listed = { type: 'dev.fabrium.design_systems', state_key: '', content: { systems: [entry('brand', { default: true })] } }

  it('lists the project space first, then the workspace', async () => {
    const { p } = provider({
      '!room:hs': [{ type: 'm.space.parent', state_key: '!project:hs', content: { via: ['hs'] } }],
      '!project:hs': [{ ...listed, content: { systems: [entry('deck', { for: ['slides'] })] } }],
      '!workspace:hs': [listed],
    })
    const { systems } = (await p.designSystem('!room:hs', {})) as { systems: Array<{ identifier: string }> }
    expect(systems.map((s) => s.identifier)).toEqual(['deck', 'brand'])
  })

  it('reads a listed system and refuses an unlisted one', async () => {
    const { p, client } = provider({ '!room:hs': [], '!workspace:hs': [listed] })
    const read = await p.designSystem('!room:hs', { identifier: 'brand' })
    expect(read).toMatchObject({ identifier: 'brand', default_for: ['slides', 'design', 'motion'], overview: '# Brand' })
    expect(client.fetchThreadRelations).toHaveBeenCalledWith(expect.objectContaining({ roomId: '!design:hs', rootEventId: '$thread' }))
    await expect(p.designSystem('!room:hs', { identifier: 'other' })).rejects.toThrow(/not_found: no listed design system "other"/)
  })
})
