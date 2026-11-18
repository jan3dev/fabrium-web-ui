import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FabriumApiError } from "../../client/fabrium-api";
import type { Agent } from "../../model/types";
import { Failure } from "./agent-dialog";

interface DeleteAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent as the list shows it now: its text follows a refresh. */
  agent: Agent;
  /** Deletes the agent, and its VM with `withVm`. Rejects with the reason it failed. */
  onConfirm: (withVm: boolean) => Promise<void>;
}

export function DeleteAgentDialog({ open, onOpenChange, agent, onConfirm }: DeleteAgentDialogProps) {
  const [running, setRunning] = useState(false);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && running) return;
        onOpenChange(next);
      }}
    >
      {open ? (
        <DeleteAgentBody
          key={agent.id}
          agent={agent}
          onConfirm={onConfirm}
          running={running}
          setRunning={setRunning}
          close={() => onOpenChange(false)}
        />
      ) : null}
    </AlertDialog>
  );
}

function DeleteAgentBody({
  agent,
  onConfirm,
  running,
  setRunning,
  close,
}: Pick<DeleteAgentDialogProps, "agent" | "onConfirm"> & {
  running: boolean;
  setRunning: (running: boolean) => void;
  close: () => void;
}) {
  const [failure, setFailure] = useState<{ message: string; step?: string } | null>(null);
  const withVm = agent.can.delete_needs_vm;
  const confirmLabel = withVm ? "Delete agent and VM" : "Delete agent";

  // Not AlertDialogAction: that closes at once, and a failure must stay in view.
  const confirm = async () => {
    setRunning(true);
    setFailure(null);
    try {
      await onConfirm(withVm);
      setRunning(false);
      close();
    } catch (err) {
      setFailure({
        message: err instanceof Error ? err.message : String(err),
        step: err instanceof FabriumApiError ? err.step : undefined,
      });
      setRunning(false);
    }
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          {agent.vm === null
            ? "This deletes the profile. It has no VM and no Matrix user."
            : withVm
              ? `${agent.name} is the last agent of the VM ${agent.vm.name}. This deletes the agent and the VM. The files on the VM are lost.`
              : "The agent leaves its rooms. Its messages stay."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Failure failure={failure} retry={confirmLabel} />
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button type="button" variant="secondary" disabled={running}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <Button
          type="button"
          variant="utility"
          tone="danger"
          disabled={running}
          onClick={confirm}
        >
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
