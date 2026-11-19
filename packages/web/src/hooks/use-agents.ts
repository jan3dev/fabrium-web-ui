import { useCallback, useEffect, useRef, useState } from "react";
import { isNoAccess, listAgents } from "../client/fabrium-api";
import type { AgentList } from "../model/types";

const POLL_FAST_MS = 5_000;
const POLL_SLOW_MS = 30_000;

const IN_TRANSITION = new Set<string | undefined>(["pending", "stopping", "shutting-down"]);

/** A VM of the list, or of an agent, that is changing state changes soon. */
const isBusy = (list: AgentList) =>
  list.vms.some((vm) => IN_TRANSITION.has(vm.state)) ||
  list.agents.some((agent) => IN_TRANSITION.has(agent.vm?.state));

interface Snapshot {
  list: AgentList | null;
  error: unknown;
}

/**
 * The agent list, kept fresh by polling as `useVms` does: every 5 s while a VM
 * is in transition, every 30 s otherwise. Polling stops when the user has no access.
 */
export function useAgents(): { list: AgentList | null; error: unknown; refresh: () => void } {
  const [snap, setSnap] = useState<Snapshot>({ list: null, error: null });
  const seqRef = useRef(0);

  // The timer and refresh() can overlap: only the newest request may update the state.
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const list = await listAgents();
      if (seq === seqRef.current) setSnap({ list, error: null });
    } catch (error) {
      if (seq === seqRef.current) setSnap((s) => ({ ...s, error }));
    }
  }, []);

  // Each snapshot arms the next load, so the delay always follows the latest list.
  useEffect(() => {
    if (isNoAccess(snap.error)) return;
    const first = snap.list === null && snap.error === null;
    const delay = first
      ? 0
      : !snap.error && snap.list && isBusy(snap.list)
        ? POLL_FAST_MS
        : POLL_SLOW_MS;
    const timer = setTimeout(load, delay);
    return () => clearTimeout(timer);
  }, [snap, load]);

  const refresh = useCallback(() => void load(), [load]);

  return { list: snap.list, error: snap.error, refresh };
}
