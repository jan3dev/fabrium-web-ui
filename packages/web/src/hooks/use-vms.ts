import { useCallback, useEffect, useRef, useState } from "react";
import { isNoAccess, listVms } from "../client/fabrium-api";
import type { Vm } from "../model/types";

export const POLL_FAST_MS = 5_000;
export const POLL_SLOW_MS = 30_000;

const IN_TRANSITION = new Set<string>(["pending", "stopping", "shutting-down"]);

/** A VM that is changing state, or still waiting for its setup, changes soon. */
export const isVmBusy = (vm: Vm) => IN_TRANSITION.has(vm.state) || vm.setup === "pending";

interface Snapshot {
  vms: Vm[] | null;
  error: unknown;
}

/**
 * The VM list, kept fresh by polling: every 5 s while any VM is in transition,
 * every 30 s otherwise. Polling stops when the user has no access.
 */
export function useVms() {
  const [snap, setSnap] = useState<Snapshot>({ vms: null, error: null });
  const seqRef = useRef(0);

  // The timer and refresh() can overlap. Only the newest request may update the
  // state, so an older answer that arrives late, a list or a failure, is dropped.
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const vms = await listVms();
      if (seq === seqRef.current) setSnap({ vms, error: null });
    } catch (error) {
      if (seq === seqRef.current) setSnap((s) => ({ ...s, error }));
    }
  }, []);

  // Each snapshot arms the next load, so the delay always follows the latest list.
  useEffect(() => {
    if (isNoAccess(snap.error)) return;
    const first = snap.vms === null && snap.error === null;
    const delay = first
      ? 0
      : !snap.error && snap.vms?.some(isVmBusy)
        ? POLL_FAST_MS
        : POLL_SLOW_MS;
    const timer = setTimeout(load, delay);
    return () => clearTimeout(timer);
  }, [snap, load]);

  const refresh = useCallback(() => void load(), [load]);

  return { vms: snap.vms, error: snap.error, refresh };
}
