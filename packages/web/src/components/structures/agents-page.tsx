import { isNoAccess } from "../../client/fabrium-api";
import { useAgents } from "../../hooks/use-agents";
import { AgentsView } from "./agents-view";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The /agents route: the agent list. */
export function AgentsRoute() {
  const { list, error, refresh } = useAgents();

  return (
    <AgentsView
      agents={list?.agents ?? null}
      error={error ? messageOf(error) : null}
      noAccess={isNoAccess(error)}
      onNew={() => {}}
      onAction={() => {}}
      onRetry={refresh}
    />
  );
}
