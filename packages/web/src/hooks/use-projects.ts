import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects } from "../client/fabrium-api";
import { lowerAscii } from "../lib/project-name";
import type { Project, ProjectList } from "../model/types";

interface State {
  list: ProjectList | null;
  error: string | null;
}

/** The order of `GET /projects`: by name without regard to ASCII case, then by id. */
const before = (a: Project, b: Project) => {
  const x = lowerAscii(a.name);
  const y = lowerAscii(b.name);
  return x < y || (x === y && a.id < b.id);
};

/**
 * The projects for a route. It loads them each time `enabled` turns true, and on `refresh`.
 * A reload keeps the list it has until the answer, so `can.manage` does not blink.
 */
export function useProjects(enabled: boolean): {
  list: ProjectList | null;
  error: string | null;
  /** Resolves after the new list is in state. */
  refresh: () => Promise<void>;
  /** Inserts a project that was just created, in its sorted place. */
  add: (project: Project) => void;
} {
  const [state, setState] = useState<State>({ list: null, error: null });
  // Only the newest load may update the state.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const list = await listProjects();
      if (mine === seq.current) setState({ list, error: null });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (mine === seq.current) setState((s) => ({ ...s, error }));
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const add = useCallback((project: Project) => {
    // A load that started before the create would not have the project: drop its answer.
    seq.current++;
    setState((s) => {
      if (!s.list) return s;
      const projects = s.list.projects.filter((p) => p.id !== project.id);
      const at = projects.findIndex((p) => before(project, p));
      projects.splice(at === -1 ? projects.length : at, 0, project);
      return { ...s, list: { ...s.list, projects } };
    });
  }, []);

  return { list: state.list, error: state.error, refresh, add };
}
