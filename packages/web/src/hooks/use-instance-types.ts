import { useEffect, useState } from "react";
import { listInstanceTypes } from "../client/fabrium-api";
import type { VmInstanceType } from "../model/types";

interface State {
  types: VmInstanceType[] | null;
  error: string | null;
}

/** The instance types for the Create VM dialog. It loads them each time `enabled` turns true. */
export function useInstanceTypes(enabled: boolean): State {
  const [state, setState] = useState<State>({ types: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setState({ types: null, error: null });
    listInstanceTypes().then(
      (types) => {
        if (current) setState({ types, error: null });
      },
      (e: unknown) => {
        if (current) setState({ types: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}
