// Fixtures for the VM and Agents pages, their dialogs, and their tests and stories.
// Data only: stories import this file, so it must stay free of test-runner imports.
import type { Agent, AgentCan, Vm, VmInstanceType } from "../src/model/types";

export const INSTANCE_TYPES: VmInstanceType[] = [
  { name: "t3a.medium", vcpus: 2, memory_mib: 4096, sev_snp: false, default: true },
  { name: "t3a.large", vcpus: 2, memory_mib: 8192, sev_snp: false, default: false },
  { name: "c6a.large", vcpus: 2, memory_mib: 4096, sev_snp: true, default: false },
];

export function makeVm(over: Partial<Vm> = {}): Vm {
  return {
    id: "i-0123456789abcdef0",
    name: "lima",
    state: "running",
    instance_type: "t3a.medium",
    sev_snp: false,
    public_ip: "203.0.113.10",
    launched_at: "2026-10-26T19:00:00Z",
    setup: "delivered",
    agents: [
      { id: "5f0c2d7a9b3e4c1d8a6f0e2b4c6d8a0f", name: "echo", agent_id: "@lima.echo:example.org" },
    ],
    creator: "@ann:example.org",
    registered: true,
    ...over,
  };
}

export const CAN_NOTHING: AgentCan = {
  edit: false,
  set_owner: false,
  assign: false,
  create_vm: false,
  delete: false,
  delete_needs_vm: false,
};

/** By default the only agent of the running VM lima, seen by its owner, who also created the VM. */
export function makeAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "5f0c2d7a9b3e4c1d8a6f0e2b4c6d8a0f",
    name: "echo",
    agent_id: "@lima.echo:example.org",
    owner: "@ann:example.org",
    description: "You are an expert software engineer who does code reviews.",
    model: "glm-5-3",
    tag: "Reviewer",
    project: "Payments",
    vm: { name: "lima", id: "i-0123456789abcdef0", state: "running", owner: "@ann:example.org" },
    source: "control-plane",
    can: { ...CAN_NOTHING, edit: true, set_owner: true, delete: true, delete_needs_vm: true },
    ...over,
  };
}

/** A profile: no VM yet, so no Matrix ID. Its owner is an agents manager. */
export const PROFILE = makeAgent({
  id: "6a1d3e8b0c4f5d2e9b7a1f3c5e7d9b1a",
  name: "scout",
  agent_id: null,
  tag: null,
  project: null,
  vm: null,
  can: { ...CAN_NOTHING, edit: true, assign: true, delete: true },
});

/** An agent whose VM was deleted: it keeps its VM name. */
export const VM_GONE = makeAgent({
  id: "7b2e4f9c1d5a6e3f0c8b2a4d6f8e0c2b",
  name: "review",
  agent_id: "@kilo.review:example.org",
  vm: { name: "kilo" },
  can: { ...CAN_NOTHING, edit: true, create_vm: true, delete: true },
});

/** An agent of the config of the central zooid: read-only. */
export const INSTANCE_AGENT: Agent = {
  id: "instance:zooid",
  name: "zooid",
  agent_id: "@zooid:example.org",
  owner: null,
  description: null,
  model: null,
  tag: null,
  project: null,
  vm: null,
  source: "instance",
  can: CAN_NOTHING,
};
