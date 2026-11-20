import { useEffect, useState } from "react";
import { listAgents } from "../client/fabrium-api";
import type { Person } from "../model/types";

interface State {
  people: Person[] | null;
  error: string | null;
}

/** The people of the workspace, from `GET /agents`. It loads them each time `enabled` turns true. */
export function usePeople(enabled: boolean): State {
  const [state, setState] = useState<State>({ people: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    listAgents().then(
      (list) => {
        if (current) setState({ people: list.people, error: null });
      },
      (e: unknown) => {
        if (current) setState({ people: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}
