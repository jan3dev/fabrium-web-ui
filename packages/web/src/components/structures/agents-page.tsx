import { useContext, useEffect, useState } from "react";
import { createAgent, isNoAccess, updateAgent } from "../../client/fabrium-api";
import { useAgents } from "../../hooks/use-agents";
import { useModels } from "../../hooks/use-models";
import { useSpaceMembers } from "../../hooks/use-space-members";
import { WorkforceSpaceContext } from "../../hooks/use-workforce";
import type { AgentInput } from "../../model/types";
import { AgentDialog } from "../dialogs/agent-dialog";
import { type AgentAction, AgentsView } from "./agents-view";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The dialog that is open: New agent, or an action on one agent, by id. */
type Open = { kind: "new" } | { kind: AgentAction; id: string };

/** The /agents route: the agent list, its row actions, and their dialogs. */
export function AgentsRoute() {
  const { list, error, refresh } = useAgents();
  const [open, setOpen] = useState<Open | null>(null);
  // Read from the current list, so a refresh reaches an open dialog.
  const target =
    open && open.kind !== "new" ? list?.agents.find((a) => a.id === open.id) : undefined;
  const editing = open?.kind === "new" || (open?.kind === "edit" && !!target);
  const { models, error: modelsError } = useModels(editing);
  const members = useSpaceMembers(useContext(WorkforceSpaceContext));

  // An agent that left the list takes its dialog with it.
  useEffect(() => {
    if (open && open.kind !== "new" && !target) setOpen(null);
  }, [open, target]);

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  const save = async (input: AgentInput) => {
    if (target) await updateAgent(target.id, input);
    else await createAgent(input);
    refresh();
  };

  return (
    <>
      <AgentsView
        agents={list?.agents ?? null}
        error={error ? messageOf(error) : null}
        noAccess={isNoAccess(error)}
        onNew={() => setOpen({ kind: "new" })}
        onAction={(agent, kind) => setOpen({ kind, id: agent.id })}
        onRetry={refresh}
      />
      <AgentDialog
        open={editing}
        onOpenChange={close}
        agent={open?.kind === "edit" ? (target ?? null) : null}
        vms={list?.vms ?? []}
        models={models}
        modelsError={modelsError}
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
        onSubmit={save}
      />
    </>
  );
}
