/**
 * Who sees an agent and what they may do with it: the tables of contracts section 2. Pure functions of the
 * caller, the records, and the live VMs. Every `can` flag and every `403` of the agent routes comes from here.
 */
import type { AgentRecord } from './agent-records.js'
import { isAdmin, managesVms, type Caller } from './auth.js'
import type { Vm } from './vms.js'

export interface Can {
  edit: boolean
  set_owner: boolean
  set_project: boolean
  assign: boolean
  create_vm: boolean
  delete: boolean
  delete_needs_vm: boolean
}

export interface World {
  caller: Caller
  /** Every record of the tenant, not only those the caller sees: "last" and `canUse` read them all. */
  records: AgentRecord[]
  /** `liveVms` of the VM list. */
  live: ReadonlyMap<string, Vm>
}

/** The live VM of each name: not shutting-down, and the newest launched_at when two are live. */
export function liveVms(vms: Vm[]): Map<string, Vm> {
  const live = new Map<string, Vm>()
  for (const vm of vms) {
    if (vm.state === 'shutting-down') continue
    const other = live.get(vm.name)
    // RFC 3339 in UTC with whole seconds: the text order is the time order.
    if (!other || (vm.launched_at ?? '') > (other.launched_at ?? '')) live.set(vm.name, vm)
  }
  return live
}

/** A project agent or VM. An absent `project_id` is personal. */
export const isProject = (x: { project_id?: string | null }): boolean => x.project_id != null

/** Personal: its owner. Project: every role. And an admin. A project agent's stored owner gives no right. */
export function managesAgent(caller: Caller, agent: AgentRecord): boolean {
  return isAdmin(caller.role) || isProject(agent) || agent.owner === caller.userId
}

/** Personal: its creator. Project: a vm-creator. And an admin. */
export function managesVm(caller: Caller, vm: Vm): boolean {
  if (isAdmin(caller.role)) return true
  return isProject(vm) ? managesVms(caller.role) : vm.creator != null && vm.creator === caller.userId
}

/** Personal agent: its owner or an admin. Project agent: an admin. */
export function agentCanSetProject(caller: Caller, agent: AgentRecord): boolean {
  return isAdmin(caller.role) || (!isProject(agent) && agent.owner === caller.userId)
}

/** Personal VM: its creator or an admin. Project VM: an admin. */
export function vmCanSetProject(caller: Caller, vm: Vm): boolean {
  return isAdmin(caller.role) || (!isProject(vm) && vm.creator != null && vm.creator === caller.userId)
}

/** The rule of the project VM, over the state after the request: a project agent on a live personal VM. */
export function breaksProjectVmRule(projectAfter: boolean, vmAfter: Vm | undefined): boolean {
  return projectAfter && vmAfter !== undefined && !isProject(vmAfter)
}

/** True when a record whose `vm` is `vmName` is a project agent. */
export function hasProjectAgent(records: readonly AgentRecord[], vmName: string): boolean {
  return records.some((r) => r.vm === vmName && isProject(r))
}

const liveVmOf = (world: World, agent: AgentRecord): Vm | undefined =>
  agent.vm === null ? undefined : world.live.get(agent.vm)

export function sees(world: World, agent: AgentRecord): boolean {
  const { caller } = world
  if (managesAgent(caller, agent)) return true
  if (caller.role !== 'vm-creator') return false
  const vm = liveVmOf(world, agent)
  return vm === undefined || managesVm(caller, vm)
}

export function can(world: World, agent: AgentRecord): Can {
  const { caller } = world
  const admin = isAdmin(caller.role)
  const vm = liveVmOf(world, agent)
  const managesLiveVm = vm !== undefined && managesVm(caller, vm)
  const edit = managesAgent(caller, agent) || managesLiveVm
  const last = vm !== undefined && !world.records.some((r) => r.id !== agent.id && r.vm === agent.vm)
  return {
    edit,
    set_owner: !isProject(agent) && (admin || managesLiveVm),
    set_project: agentCanSetProject(caller, agent),
    assign: edit && agent.vm === null,
    create_vm: vm === undefined && managesVms(caller.role),
    delete: last ? managesLiveVm : edit,
    delete_needs_vm: last,
  }
}

/** True when the caller may put an agent on this live VM. */
export function canUse(world: World, vm: Vm): boolean {
  const { userId, role } = world.caller
  return (
    isProject(vm) ||
    isAdmin(role) ||
    vm.creator === userId ||
    world.records.some((r) => r.vm === vm.name && !isProject(r) && r.owner === userId)
  )
}
