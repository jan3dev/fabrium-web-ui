import { useEffect, useState } from "react";
import { listModels } from "../client/fabrium-api";
import type { ModelList } from "../model/types";

interface State {
  models: ModelList | null;
  error: string | null;
}

/** The Haven models for the agent dialog. It loads them each time `enabled` turns true. */
export function useModels(enabled: boolean): State {
  const [state, setState] = useState<State>({ models: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setState({ models: null, error: null });
    listModels().then(
      (models) => {
        if (current) setState({ models, error: null });
      },
      (e: unknown) => {
        if (current) setState({ models: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}
