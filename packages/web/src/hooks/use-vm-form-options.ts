import { useEffect, useState } from "react";
import { listAgents, listInstanceTypes } from "../client/fabrium-api";
import type { VmFormOptions } from "../model/types";

interface State {
  options: VmFormOptions | null;
  error: string | null;
}

/**
 * The instance types and agents for the New VM dialog. It loads them each time
 * `enabled` turns true, because creating a VM changes which agents are free.
 */
export function useVmFormOptions(enabled: boolean): State {
  const [state, setState] = useState<State>({ options: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setState({ options: null, error: null });
    Promise.all([listInstanceTypes(), listAgents()]).then(
      ([instanceTypes, agents]) => {
        if (current) setState({ options: { instanceTypes, agents }, error: null });
      },
      (e: unknown) => {
        if (current) {
          setState({ options: null, error: e instanceof Error ? e.message : String(e) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}
