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

const liveVmOf = (world: World, agent: AgentRecord): Vm | undefined =>
  agent.vm === null ? undefined : world.live.get(agent.vm)

export function sees(world: World, agent: AgentRecord): boolean {
  const { userId, role } = world.caller
  if (isAdmin(role) || agent.owner === userId) return true
  if (role !== 'vm-creator') return false
  const vm = liveVmOf(world, agent)
  return vm === undefined || vm.creator === userId
}

export function can(world: World, agent: AgentRecord): Can {
  const { userId, role } = world.caller
  const admin = isAdmin(role)
  const vm = liveVmOf(world, agent)
  // The VM owner is the creator of the live VM. Without a live VM, or without a creator, there is none.
  const vmOwner = vm !== undefined && vm.creator === userId
  const edit = admin || vmOwner || agent.owner === userId
  const last = vm !== undefined && !world.records.some((r) => r.id !== agent.id && r.vm === agent.vm)
  return {
    edit,
    set_owner: admin || vmOwner,
    assign: edit && agent.vm === null,
    create_vm: vm === undefined && managesVms(role),
    delete: last ? admin || vmOwner : edit,
    delete_needs_vm: last,
  }
}

/** True when the caller may put an agent on this live VM. */
export function canUse(world: World, vm: Vm): boolean {
  const { userId, role } = world.caller
  return (
    isAdmin(role) ||
    vm.creator === userId ||
    world.records.some((r) => r.vm === vm.name && r.owner === userId)
  )
}
