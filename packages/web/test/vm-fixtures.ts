// Fixtures for the VM and Agents pages, their dialogs, and their tests and stories.
// Data only: stories import this file, so it must stay free of test-runner imports.
import type { Agent, AgentCan, Project, Vm, VmInstanceType } from "../src/model/types";

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
    project_id: null,
    project: null,
    can: { set_project: true },
    ...over,
  };
}

export const CAN_NOTHING: AgentCan = {
  edit: false,
  set_owner: false,
  set_project: false,
  assign: false,
  create_vm: false,
  delete: false,
  delete_needs_vm: false,
};

/** By default the personal agent of the running VM lima, seen by its owner, who also created the VM. */
export function makeAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "5f0c2d7a9b3e4c1d8a6f0e2b4c6d8a0f",
    name: "echo",
    agent_id: "@lima.echo:example.org",
    owner: "@ann:example.org",
    description: "You are an expert software engineer who does code reviews.",
    model: "glm-5-3",
    tag: "Reviewer",
    project_id: null,
    project: null,
    vm: {
      name: "lima",
      id: "i-0123456789abcdef0",
      state: "running",
      owner: "@ann:example.org",
      project_id: null,
    },
    source: "control-plane",
    can: {
      ...CAN_NOTHING,
      edit: true,
      set_owner: true,
      set_project: true,
      delete: true,
      delete_needs_vm: true,
    },
    ...over,
  };
}

/** A profile: no VM yet, so no Matrix ID. Its owner is an agents manager. */
export const PROFILE = makeAgent({
  id: "6a1d3e8b0c4f5d2e9b7a1f3c5e7d9b1a",
  name: "scout",
  agent_id: null,
  tag: null,
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
  project_id: null,
  project: null,
  vm: null,
  source: "instance",
  can: CAN_NOTHING,
};

export const PAYMENTS: Project = { id: "9a1c0e2b4c6d8a0f5f0c2d7a9b3e4c1d", name: "Payments", in_use: true };
export const MARKETING: Project = { id: "3e5a7c9b1d2f4e6a8c0b2d4f6a8c0e1b", name: "Marketing", in_use: false };
/** Sorted by name, as `GET /projects` answers. */
export const PROJECTS: Project[] = [MARKETING, PAYMENTS];

/** An agent of Payments on the project VM kilo, seen by an admin. Its stored owner is data only. */
export const PROJECT_AGENT = makeAgent({
  id: "1c3e5a7b9d0f2e4c6a8b0d2f4e6c8a0b",
  name: "triage",
  agent_id: "@kilo.triage:example.org",
  owner: "@nina:example.org",
  tag: null,
  project_id: PAYMENTS.id,
  project: PAYMENTS.name,
  vm: {
    name: "kilo",
    id: "i-0123456789abcdef4",
    state: "running",
    owner: "@nina:example.org",
    project_id: PAYMENTS.id,
  },
  can: { ...CAN_NOTHING, edit: true, set_project: true, delete: true, delete_needs_vm: true },
});

/** The project VM kilo of Payments, seen by an admin. Its creator is data only. */
export const PROJECT_VM = makeVm({
  id: "i-0123456789abcdef4",
  name: "kilo",
  public_ip: "203.0.113.11",
  agents: [{ id: PROJECT_AGENT.id, name: "triage", agent_id: "@kilo.triage:example.org" }],
  creator: "@nina:example.org",
  project_id: PAYMENTS.id,
  project: PAYMENTS.name,
  can: { set_project: true },
});
