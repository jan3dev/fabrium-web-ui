import { PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Agent } from "../../model/types";
import { FirstLoad, Notice, STATE_TONE } from "./vm-view";

export type AgentAction = "edit" | "create-vm" | "delete";

const HEADERS = ["Name", "Owner", "Tag", "Project", "Model", "VM"];

const CELL = "px-4 py-3 text-body2 break-all text-text-secondary";

interface AgentsViewProps {
  /** `null` until the first answer. */
  agents: Agent[] | null;
  /** The last error from loading the list. */
  error: string | null;
  /** The user has no Fabrium role, or agent management is off. */
  noAccess: boolean;
  onNew: () => void;
  onAction: (agent: Agent, action: AgentAction) => void;
  onRetry: () => void;
}

/** The Agents page. It shows each action from the `can` flags of the agent, never from a rule of its own. */
export function AgentsView({ agents, error, noAccess, onNew, onAction, onRetry }: AgentsViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <h1 className="font-heading text-subtitle font-medium">Agents</h1>
        {noAccess ? null : (
          <Button size="sm" onClick={onNew}>
            <PlusIcon aria-hidden />
            New agent
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {noAccess ? (
          <Notice title="No access">
            Only workspace agent managers, VM creators, admins, and owners can
            manage agents. If you are one, agent management may be off for this
            workspace.
          </Notice>
        ) : agents === null ? (
          <FirstLoad what="agents" error={error} onRetry={onRetry} />
        ) : agents.length === 0 ? (
          <Notice title="No agents yet">Create a profile first. It gets a VM later.</Notice>
        ) : (
          <>
            {error ? (
              <Alert tone="danger" className="mb-4">
                <p>Could not refresh the list. {error}</p>
              </Alert>
            ) : null}
            <div className="overflow-x-auto rounded-card border border-surface-border-primary">
              <table className="w-full min-w-[60rem] border-collapse text-left">
                <thead className="bg-surface-secondary">
                  <tr>
                    {HEADERS.map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="px-4 py-2 text-caption1 font-medium text-text-secondary"
                      >
                        {header}
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} onAction={onAction} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  onAction,
}: {
  agent: Agent;
  onAction: (agent: Agent, action: AgentAction) => void;
}) {
  const { vm, can } = agent;
  const instance = agent.source === "instance";
  // A profile, or an agent whose VM is gone: a VM can be created for it.
  const noLiveVm = !instance && !vm?.state;
  return (
    <tr className="border-t border-surface-border-primary align-top first:border-t-0">
      <th scope="row" className="px-4 py-3 text-left text-body2 font-medium text-text-primary">
        <div>{agent.name}</div>
        {agent.agent_id ? (
          <div className="text-caption1 font-normal break-all text-text-secondary">
            {agent.agent_id}
          </div>
        ) : null}
      </th>
      <td className={CELL}>{agent.owner}</td>
      <td className={CELL}>{agent.tag}</td>
      <td className={CELL}>{agent.project}</td>
      <td className={CELL}>{agent.model}</td>
      <td className="px-4 py-3">
        {instance ? (
          <Badge tone="neutral">Runs on the instance</Badge>
        ) : vm === null ? (
          <span className="text-body2 text-text-secondary">No VM</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-body2 text-text-primary">
            {vm.name}
            {vm.state ? (
              <Badge tone={STATE_TONE[vm.state] ?? "neutral"}>{vm.state}</Badge>
            ) : (
              <Badge tone="neutral">No VM running</Badge>
            )}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5">
          {can.edit ? (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              aria-label={`Edit ${agent.name}`}
              onClick={() => onAction(agent, "edit")}
            >
              Edit
            </Button>
          ) : null}
          {noLiveVm ? (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              aria-label={`Create VM for ${agent.name}`}
              disabled={!can.create_vm}
              title={can.create_vm ? undefined : "Only a VM creator or an admin can create a VM."}
              onClick={() => onAction(agent, "create-vm")}
            >
              Create VM
            </Button>
          ) : null}
          {can.delete ? (
            <Button
              type="button"
              size="xs"
              variant="utility"
              tone="danger"
              aria-label={`Delete ${agent.name}`}
              onClick={() => onAction(agent, "delete")}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
