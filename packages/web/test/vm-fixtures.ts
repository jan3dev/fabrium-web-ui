// Fixtures for the VM page, its dialog, and their tests and stories. Data only:
// stories import this file, so it must stay free of test-runner imports.
import type { Vm } from "../src/model/types";

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
