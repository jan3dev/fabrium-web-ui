import { useEffect, useState } from "react";
import {
  createAgent,
  createProject,
  createVm,
  deleteAgent,
  isNoAccess,
  updateAgent,
} from "../../client/fabrium-api";
import { useAgents } from "../../hooks/use-agents";
import { useInstanceTypes } from "../../hooks/use-instance-types";
import { useModels } from "../../hooks/use-models";
import { useProjects } from "../../hooks/use-projects";
import type { AgentInput, CreateVmRequest } from "../../model/types";
import { AgentDialog } from "../dialogs/agent-dialog";
import { CreateVmDialog } from "../dialogs/create-vm-dialog";
import { DeleteAgentDialog } from "../dialogs/delete-agent-dialog";
import { type AgentAction, AgentsView } from "./agents-view";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The dialog that is open: New agent, or an action on one agent, by id. */
type Open = { kind: "new" } | { kind: AgentAction; id: string };

/** The /agents route: the agent list, its row actions, and their dialogs. */
export function AgentsRoute() {
  const { list, error, refresh } = useAgents();
  // Loaded with the page: can.manage decides what the page offers before a dialog opens.
  const projects = useProjects(true);
  const [open, setOpen] = useState<Open | null>(null);
  // Read from the current list, so a refresh reaches an open dialog.
  const target =
    open && open.kind !== "new" ? list?.agents.find((a) => a.id === open.id) : undefined;
  const editing = open?.kind === "new" || (open?.kind === "edit" && !!target);
  const { models, error: modelsError } = useModels(editing);
  const { types, error: typesError } = useInstanceTypes(open?.kind === "create-vm" && !!target);

  // An agent that left the list takes its dialog with it.
  useEffect(() => {
    if (open && open.kind !== "new" && !target) setOpen(null);
  }, [open, target]);

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };
  // Each dialog starts from the projects as they are now.
  const show = (next: Open) => {
    setOpen(next);
    void projects.refresh();
  };
  const createProjectFor = async (name: string) => {
    const project = await createProject(name);
    projects.add(project);
    return project;
  };
  const save = async (input: AgentInput) => {
    try {
      if (target) await updateAgent(target.id, input);
      else await createAgent(input);
    } catch (e) {
      // Another admin deleted the project: the dialog shows it once the list has it gone.
      if (e instanceof Error && e.message === "unknown project") await projects.refresh();
      throw e;
    }
    refresh();
  };
  // After a failure too: the list may be stale, and the dialog shows the agent as it is now.
  const createVmFor = async (req: CreateVmRequest) => {
    try {
      await createVm(req);
    } finally {
      refresh();
    }
  };
  const remove = async (withVm: boolean) => {
    if (!target) return;
    try {
      await deleteAgent(target.id, withVm);
    } finally {
      refresh();
    }
  };

  return (
    <>
      <AgentsView
        agents={list?.agents ?? null}
        error={error ? messageOf(error) : null}
        noAccess={isNoAccess(error)}
        onNew={() => show({ kind: "new" })}
        onAction={(agent, kind) => show({ kind, id: agent.id })}
        onRetry={refresh}
      />
      <AgentDialog
        open={editing}
        onOpenChange={close}
        agent={open?.kind === "edit" ? (target ?? null) : null}
        vms={list?.vms ?? []}
        models={models}
        modelsError={modelsError}
        members={(list?.people ?? []).map((p) => ({ userId: p.user_id, name: p.name }))}
        projects={projects.list?.projects ?? null}
        projectsError={projects.error}
        canManageProjects={projects.list?.can.manage ?? false}
        onCreateProject={createProjectFor}
        onSubmit={save}
      />
      {target ? (
        <>
          <CreateVmDialog
            open={open?.kind === "create-vm"}
            onOpenChange={close}
            agent={target}
            types={types}
            typesError={typesError}
            onSubmit={createVmFor}
          />
          <DeleteAgentDialog
            open={open?.kind === "delete"}
            onOpenChange={close}
            agent={target}
            onConfirm={remove}
          />
        </>
      ) : null}
    </>
  );
}
