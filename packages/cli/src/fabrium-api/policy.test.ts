import { expect, it } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import type { Role } from './auth.js'
import { can, canUse, liveVms, sees, type World } from './policy.js'
import type { Vm } from './vms.js'

const ROLES: Record<string, Role> = {
  '@ann': 'admin',
  '@luis': 'vm-creator',
  '@vera': 'vm-creator',
  '@ana': 'agents-manager',
  '@bob': 'agents-manager',
}
const user = (local: string) => `${local}:example.org`
const vm = (name: string, creator: string | null, extra: Partial<Vm> = {}): Vm => ({
  id: `i-${name}`,
  name,
  state: 'running',
  creator: creator === null ? null : user(creator),
  launched_at: '2026-11-18T19:00:00Z',
  ...extra,
})
const record = (id: string, onVm: string | null, owner: string): AgentRecord => ({
  id,
  name: id,
  owner: user(owner),
  description: '',
  model: 'glm-5-3',
  tag: null,
  project: null,
  vm: onVm,
  rooms: onVm ? ['#general:example.org'] : [],
})
// quito has records and no VM.
const VMS = [vm('lima', '@luis'), vm('cusco', '@vera')]
const RECORDS = [
  record('p1', null, '@ana'),
  record('p2', null, '@bob'),
  record('a1', 'lima', '@ana'),
  record('a2', 'lima', '@luis'),
  record('a3', 'cusco', '@bob'),
  record('a4', 'quito', '@bob'),
]
const world = (caller: string, vms = VMS): World => ({
  caller: { userId: user(caller), role: ROLES[caller]! },
  records: RECORDS,
  live: liveVms(vms),
})
const byId = (id: string) => RECORDS.find((r) => r.id === id)!

it.each([
  ['@ann', ['p1', 'p2', 'a1', 'a2', 'a3', 'a4']],
  ['@luis', ['p1', 'p2', 'a1', 'a2', 'a4']],
  ['@vera', ['p1', 'p2', 'a3', 'a4']],
  ['@ana', ['p1', 'a1']],
  ['@bob', ['p2', 'a3', 'a4']],
])('%s sees %j', (caller, ids) => {
  const w = world(caller)
  expect(RECORDS.filter((r) => sees(w, r)).map((r) => r.id)).toEqual(ids)
})

it.each([
  // caller, record, edit, set_owner, assign, create_vm, delete, delete_needs_vm
  ['@ana', 'a1', true, false, false, false, true, false],
  ['@luis', 'a1', true, true, false, false, true, false],
  ['@bob', 'a3', true, false, false, false, false, true],
  ['@vera', 'a3', true, true, false, false, true, true],
  ['@ana', 'p1', true, false, true, false, true, false],
  ['@luis', 'p1', false, false, false, true, false, false],
  ['@bob', 'a4', true, false, false, false, true, false],
  ['@luis', 'a4', false, false, false, true, false, false],
  ['@ann', 'p2', true, true, true, true, true, false],
  ['@ann', 'a3', true, true, false, false, true, true],
  ['@ann', 'a4', true, true, false, true, true, false],
] as const)('%s on %s', (caller, id, edit, setOwner, assign, createVm, del, deleteNeedsVm) => {
  expect(can(world(caller), byId(id))).toEqual({
    edit,
    set_owner: setOwner,
    assign,
    create_vm: createVm,
    delete: del,
    delete_needs_vm: deleteNeedsVm,
  })
})

it.each([
  ['@ann', ['cusco', 'lima']],
  ['@luis', ['lima']],
  ['@ana', ['lima']],
  ['@bob', ['cusco']],
  ['@vera', ['cusco']],
])('%s can use %j', (caller, names) => {
  const w = world(caller)
  expect([...w.live.values()].filter((v) => canUse(w, v)).map((v) => v.name).sort()).toEqual(names)
})

it('a shutting-down VM is not live, and its pending twin is', () => {
  // The old VM of a replace: shutting down, and with the newest launch (EC2 resets it at each start).
  const old = vm('lima', '@luis', { id: 'i-old', state: 'shutting-down', launched_at: '2026-11-18T21:00:00Z' })
  const replacement = vm('lima', '@luis', { id: 'i-new', state: 'pending', launched_at: '2026-11-18T20:00:00Z' })
  for (const list of [[old, replacement], [replacement, old]]) {
    expect(liveVms(list).get('lima')?.id).toBe('i-new')
  }
  // Two live VMs of one name: the newest launched_at counts, in either order.
  const stopped = { ...old, state: 'stopped', launched_at: '2026-11-18T19:00:00Z' }
  for (const list of [[stopped, replacement], [replacement, stopped]]) {
    expect(liveVms(list).get('lima')?.id).toBe('i-new')
  }
  // Only the shutting-down VM: lima has no live VM, so a1 has no VM owner and can get a new VM.
  const w = world('@luis', [old, vm('cusco', '@vera')])
  expect(w.live.has('lima')).toBe(false)
  expect(sees(w, byId('a1'))).toBe(true)
  expect(can(w, byId('a1'))).toEqual({
    edit: false,
    set_owner: false,
    assign: false,
    create_vm: true,
    delete: false,
    delete_needs_vm: false,
  })
})

it('a VM without launched_at is still live', () => {
  const { launched_at: _, ...bare } = vm('lima', '@luis')
  expect(liveVms([bare as Vm]).get('lima')?.id).toBe('i-lima')
})

it('a live VM without a creator has no VM owner', () => {
  const vms = [vm('lima', null), vm('cusco', '@vera')]
  for (const caller of Object.keys(ROLES)) {
    expect(can(world(caller, vms), byId('a1')).set_owner, caller).toBe(caller === '@ann')
  }
})
