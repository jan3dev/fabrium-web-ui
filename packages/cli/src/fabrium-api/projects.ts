/**
 * The project routes of the browser API: `/projects` and `/projects/:id` (contracts section 2, "Project view").
 * Every role reads; only an admin writes. The writes run in the one queue.
 */
import type { Context, Hono } from 'hono'
import type { AgentRecord } from './agent-records.js'
import { loadWorld, rebuildRoster, type AgentContext, type Env } from './agents.js'
import { isAdmin, type Caller } from './auth.js'
import { ApiError } from './errors.js'
import type { Launches } from './launches.js'
import { createProject, removeProject, renameProject, type Project } from './project-records.js'
import type { Vm } from './vms.js'

export interface ProjectView {
  id: string
  name: string
  in_use: boolean
}

/** `in_use`: an agent record, a VM that the control plane lists, or a launch of the last 10 minutes has it. */
export function projectView(
  p: Project,
  world: { records: AgentRecord[]; vms: Vm[] },
  launches: Pick<Launches, 'hasProject'>,
): ProjectView {
  const has = (x: { project_id?: string | null }) => x.project_id === p.id
  return { id: p.id, name: p.name, in_use: world.records.some(has) || world.vms.some(has) || launches.hasProject(p.id) }
}

function checkAdmin(caller: Caller): void {
  if (!isAdmin(caller.role)) throw new ApiError(403, { error: 'forbidden' })
}

/** The name of a body that is exactly `{"name": string}`, trimmed. The control plane judges the name rule. */
async function nameOf(c: Context<Env>): Promise<string> {
  const b: unknown = await c.req.json().catch(() => undefined)
  const name = (b as { name?: unknown } | null)?.name
  if (typeof b !== 'object' || b === null || Object.keys(b).join() !== 'name' || typeof name !== 'string') {
    throw new ApiError(400, { error: 'invalid request body' })
  }
  return name.trim()
}

export function projectRoutes(app: Hono<Env>, ctx: AgentContext): void {
  app.get('/projects', async (c) => {
    const caller = c.get('caller')
    const world = await loadWorld(ctx, caller)
    return c.json({
      projects: world.projects.map((p) => projectView(p, world, ctx.launches)),
      can: { manage: isAdmin(caller.role) },
    })
  })

  app.post('/projects', async (c) => {
    checkAdmin(c.get('caller'))
    const name = await nameOf(c)
    return ctx.queue(async () => {
      const made = await createProject(ctx.controlPlane, name)
      return c.json({ id: made.id, name: made.name, in_use: false } satisfies ProjectView, 201)
    })
  })

  app.put('/projects/:id', async (c) => {
    const caller = c.get('caller')
    checkAdmin(caller)
    const name = await nameOf(c)
    return ctx.queue(async () => {
      const world = await loadWorld(ctx, caller)
      const renamed = await renameProject(ctx.controlPlane, c.req.param('id'), name)
      // The rosters that show the name: one rebuild for each VM name with an agent of the project.
      const projects = [...world.projects.filter((p) => p.id !== renamed.id), renamed]
      const names = new Set(world.records.filter((r) => r.project_id === renamed.id).map((r) => r.vm))
      for (const vm of names) if (vm !== null) await rebuildRoster(ctx, vm, world.records, projects)
      return c.json(projectView(renamed, world, ctx.launches))
    })
  })

  // Not gated on in_use: a registry row that the VM list does not show can keep the project, and the control
  // plane answers 409 for it. A launch is not in the control plane yet: zooid refuses it itself.
  app.delete('/projects/:id', async (c) => {
    checkAdmin(c.get('caller'))
    const id = c.req.param('id')
    return ctx.queue(async () => {
      if (ctx.launches.hasProject(id)) throw new ApiError(409, { error: 'project in use' })
      await removeProject(ctx.controlPlane, id)
      return c.body(null, 204)
    })
  })
}
