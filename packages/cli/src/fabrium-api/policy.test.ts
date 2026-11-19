import { expect, it } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import type { Role } from './auth.js'
import {
  agentCanSetProject,
  breaksProjectVmRule,
  can,
  canUse,
  hasProjectAgent,
  isProject,
  liveVms,
  managesAgent,
  managesVm,
  sees,
  vmCanSetProject,
  vmKind,
  type World,
} from './policy.js'
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
const record = (id: string, onVm: string | null, owner: string, projectId: string | null = null): AgentRecord => ({
  id,
  name: id,
  owner: user(owner),
  description: '',
  model: 'glm-5-3',
  tag: null,
  project: null,
  project_id: projectId,
  vm: onVm,
  rooms: onVm ? ['#general:example.org'] : [],
})
// quito has records and no VM. hub and dock are project VMs of pr1.
const VMS = [
  vm('lima', '@luis'),
  vm('cusco', '@vera'),
  vm('hub', '@luis', { project_id: 'pr1' }),
  vm('dock', null, { project_id: 'pr1' }),
]
const RECORDS = [
  record('p1', null, '@ana'),
  record('p2', null, '@bob'),
  record('a1', 'lima', '@ana'),
  record('a2', 'lima', '@luis'),
  record('a3', 'cusco', '@bob'),
  record('a4', 'quito', '@bob'),
  record('q1', null, '@ana', 'pr1'),
  record('q2', 'hub', '@bob', 'pr1'),
  record('q3', 'hub', '@bob'),
  record('q4', 'dock', '@ana', 'pr1'),
]
const world = (caller: string, vms = VMS): World => ({
  caller: { userId: user(caller), role: ROLES[caller]! },
  records: RECORDS,
  live: liveVms(vms),
})
const byId = (id: string) => RECORDS.find((r) => r.id === id)!

it.each([
  ['@ann', ['p1', 'p2', 'a1', 'a2', 'a3', 'a4', 'q1', 'q2', 'q3', 'q4']],
  ['@luis', ['p1', 'p2', 'a1', 'a2', 'a4', 'q1', 'q2', 'q3', 'q4']],
  ['@vera', ['p1', 'p2', 'a3', 'a4', 'q1', 'q2', 'q3', 'q4']],
  // Not q3: a personal agent of another member, also on a project VM.
  ['@ana', ['p1', 'a1', 'q1', 'q2', 'q4']],
  ['@bob', ['p2', 'a3', 'a4', 'q1', 'q2', 'q3', 'q4']],
])('%s sees %j', (caller, ids) => {
  const w = world(caller)
  expect(RECORDS.filter((r) => sees(w, r)).map((r) => r.id)).toEqual(ids)
})

it.each([
  // caller, record, edit, set_owner, set_project, assign, create_vm, delete, delete_needs_vm
  ['@ana', 'a1', true, false, true, false, false, true, false],
  ['@luis', 'a1', true, true, false, false, false, true, false],
  ['@bob', 'a3', true, false, true, false, false, false, true],
  ['@vera', 'a3', true, true, false, false, false, true, true],
  ['@ana', 'p1', true, false, true, true, false, true, false],
  ['@luis', 'p1', false, false, false, false, true, false, false],
  ['@bob', 'a4', true, false, true, false, false, true, false],
  ['@luis', 'a4', false, false, false, false, true, false, false],
  ['@ann', 'p2', true, true, true, true, true, true, false],
  ['@ann', 'a3', true, true, true, false, false, true, true],
  ['@ann', 'a4', true, true, true, false, true, true, false],
  ['@ana', 'q1', true, false, false, true, false, true, false],
  ['@luis', 'q1', true, false, false, true, true, true, false],
  ['@ann', 'q1', true, false, true, true, true, true, false],
  ['@bob', 'q2', true, false, false, false, false, true, false],
  ['@ana', 'q3', false, false, false, false, false, false, false],
  // A vm-creator changes the owner of a personal agent on a project VM.
  ['@luis', 'q3', true, true, false, false, false, true, false],
  ['@bob', 'q3', true, false, true, false, false, true, false],
  // An agents-manager cannot delete the last agent of a live project VM; a vm-creator manages that VM, so can.
  ['@ana', 'q4', true, false, false, false, false, false, true],
  ['@vera', 'q4', true, false, false, false, false, true, true],
] as const)('%s on %s', (caller, id, edit, setOwner, setProject, assign, createVm, del, deleteNeedsVm) => {
  expect(can(world(caller), byId(id))).toEqual({
    edit,
    set_owner: setOwner,
    set_project: setProject,
    assign,
    create_vm: createVm,
    delete: del,
    delete_needs_vm: deleteNeedsVm,
  })
})

it.each([
  ['@ann', ['cusco', 'dock', 'hub', 'lima']],
  ['@luis', ['dock', 'hub', 'lima']],
  ['@vera', ['cusco', 'dock', 'hub']],
  ['@ana', ['dock', 'hub', 'lima']],
  ['@bob', ['cusco', 'dock', 'hub']],
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
    set_project: false,
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

it('the stored owner of a project agent gives no right on a personal VM', () => {
  // A project agent of @bob on lima: @bob cannot use lima.
  const w = { ...world('@bob'), records: [record('x1', 'lima', '@bob', 'pr1')] }
  expect(canUse(w, w.live.get('lima')!)).toBe(false)
  expect(canUse({ ...w, records: [record('x1', 'lima', '@bob')] }, w.live.get('lima')!)).toBe(true)
})

const caller = (local: string) => ({ userId: user(local), role: ROLES[local]! })
const vmByName = (name: string) => VMS.find((v) => v.name === name)!

it.each([
  ['lima', ['@ann', '@luis']],
  ['hub', ['@ann', '@luis', '@vera']],
  ['dock', ['@ann', '@luis', '@vera']],
  ['cusco', ['@ann', '@vera']],
])('who manages %s: %j', (name, who) => {
  expect(Object.keys(ROLES).filter((c) => managesVm(caller(c), vmByName(name)))).toEqual(who)
})

it('only an admin manages a personal VM without a creator', () => {
  expect(Object.keys(ROLES).filter((c) => managesVm(caller(c), vm('old', null)))).toEqual(['@ann'])
})

it.each([
  ['p1', ['@ann', '@ana']],
  ['a3', ['@ann', '@bob']],
  ['q1', ['@ann', '@luis', '@vera', '@ana', '@bob']],
  ['q2', ['@ann', '@luis', '@vera', '@ana', '@bob']],
])('who manages the agent %s: %j', (id, who) => {
  expect(Object.keys(ROLES).filter((c) => managesAgent(caller(c), byId(id)))).toEqual(who)
})

it.each([
  ['lima', ['@ann', '@luis']],
  ['cusco', ['@ann', '@vera']],
  ['hub', ['@ann']],
])('who sets the project of the VM %s: %j', (name, who) => {
  expect(Object.keys(ROLES).filter((c) => vmCanSetProject(caller(c), vmByName(name)))).toEqual(who)
})

it.each([
  ['p1', ['@ann', '@ana']],
  ['q2', ['@ann']],
])('who sets the project of the agent %s: %j', (id, who) => {
  expect(Object.keys(ROLES).filter((c) => agentCanSetProject(caller(c), byId(id)))).toEqual(who)
})

it('breaksProjectVmRule', () => {
  expect(breaksProjectVmRule(false, vmByName('lima'))).toBe(false)
  expect(breaksProjectVmRule(true, vmByName('lima'))).toBe(true)
  expect(breaksProjectVmRule(true, vmByName('hub'))).toBe(false)
  expect(breaksProjectVmRule(true, undefined)).toBe(false)
  expect(breaksProjectVmRule(false, undefined)).toBe(false)
})

it('vmKind: the live VM of the name, else a launch, else none', () => {
  const launching = new Map([
    ['lima', { project_id: 'pr1' }],
    ['quito', { project_id: null }],
  ])
  const launches = { get: (name: string) => launching.get(name) }
  const w = world('@ann')
  // The listed live VM wins over a launch of its name.
  expect(vmKind(w, launches, 'lima')).toBe(w.live.get('lima'))
  expect(vmKind(w, launches, 'quito')).toEqual({ project_id: null })
  expect(breaksProjectVmRule(true, vmKind(w, launches, 'quito'))).toBe(true)
  expect(vmKind(w, launches, 'nowhere')).toBeUndefined()
  expect(vmKind(w, launches, null)).toBeUndefined()
})

it('hasProjectAgent looks at every record of the VM name, live or not', () => {
  expect(hasProjectAgent(RECORDS, 'hub')).toBe(true)
  expect(hasProjectAgent(RECORDS, 'lima')).toBe(false)
  expect(hasProjectAgent([record('x1', 'quito', '@bob', 'pr1')], 'quito')).toBe(true)
  expect(hasProjectAgent(RECORDS, 'quito')).toBe(false)
})

it('an absent project_id on a record or a VM is personal', () => {
  const { project_id: _, ...bare } = record('x1', 'lima', '@ana')
  expect(isProject(bare)).toBe(false)
  expect(isProject(vm('lima', '@luis'))).toBe(false)
  expect(isProject({ project_id: null })).toBe(false)
  expect(isProject({ project_id: 'pr1' })).toBe(true)
  expect(managesAgent(caller('@bob'), bare as AgentRecord)).toBe(false)
})
