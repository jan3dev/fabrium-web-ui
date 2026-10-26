// Fixtures for the VM page, its dialog, and their tests and stories. Data only:
// stories import this file, so it must stay free of test-runner imports.
import type { Vm, VmAgent, VmInstanceType } from "../src/model/types";

export const INSTANCE_TYPES: VmInstanceType[] = [
  { name: "t3a.medium", vcpus: 2, memory_mib: 4096, sev_snp: false, default: true },
  { name: "t3a.large", vcpus: 2, memory_mib: 8192, sev_snp: false, default: false },
  { name: "c6a.large", vcpus: 2, memory_mib: 4096, sev_snp: true, default: false },
];

/** Two free agents and one that already runs on a VM. */
export const AGENTS: VmAgent[] = [
  { workstation: "nova", agent_id: "@nova.echo:example.org", preset: "opencode", free: true },
  { workstation: "orion", agent_id: "@orion.scout:example.org", preset: "opencode", free: true },
  { workstation: "quark", agent_id: "@quark.review:example.org", preset: "opencode", free: false },
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
    agent_id: "@lima.echo:example.org",
    ...over,
  };
}
