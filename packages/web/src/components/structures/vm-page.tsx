import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  deleteVm,
  isNoAccess,
  rebootVm,
  recreateVm,
  setAutoStop,
  startVm,
  stopVm,
} from "../../client/fabrium-api";
import { useVms } from "../../hooks/use-vms";
import type { Vm, VmCredentials } from "../../model/types";
import { UpdateCredentialsDialog } from "../dialogs/update-credentials-dialog";
import { type VmAction, VmView } from "./vm-view";

const RUN = {
  start: startVm,
  stop: stopVm,
  reboot: rebootVm,
  delete: deleteVm,
} satisfies Record<
  Exclude<VmAction, "credentials">,
  (id: string, autoStopHours?: number) => Promise<unknown>
>;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The /vm route: the VM list, its row actions, and the Update credentials dialog.
 * A VM is created from an agent, on the Agents page.
 */
export function VmRoute() {
  const { vms, error, refresh } = useVms();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  // The VM whose Update credentials dialog is open, by id.
  const [replacing, setReplacing] = useState<string | null>(null);
  const replaced = vms?.find((vm) => vm.id === replacing);

  // Forget a VM that left the list, so its return cannot bring back the dialog.
  useEffect(() => {
    if (replacing && !replaced) setReplacing(null);
  }, [replacing, replaced]);

  const recreate = async (vm: Vm, creds: VmCredentials) => {
    try {
      await recreateVm(vm.id, creds);
    } finally {
      refresh();
    }
  };

  /** Runs `work` on a VM with its buttons disabled, then refreshes the list. */
  const run = async (vm: Vm, what: string, work: () => Promise<unknown>) => {
    setBusyIds((ids) => new Set(ids).add(vm.id));
    try {
      await work();
    } catch (e) {
      toast.error(`Could not ${what} ${vm.name}: ${messageOf(e)}`);
    } finally {
      setBusyIds((ids) => {
        const rest = new Set(ids);
        rest.delete(vm.id);
        return rest;
      });
      // After a failure too: a 409 means the state is not what the list shows.
      refresh();
    }
  };

  const onAction = (vm: Vm, action: VmAction, autoStopHours?: number) =>
    action === "credentials"
      ? setReplacing(vm.id)
      : run(vm, action, () => RUN[action](vm.id, autoStopHours));
  const onSetAutoStop = (vm: Vm, hours: number) =>
    run(vm, "set the auto-stop of", () => setAutoStop(vm.id, hours));

  return (
    <>
      <VmView
        vms={vms}
        error={error ? messageOf(error) : null}
        noAccess={isNoAccess(error)}
        busyIds={busyIds}
        onAction={onAction}
        onSetAutoStop={onSetAutoStop}
        onRetry={refresh}
      />
      {replaced ? (
        <UpdateCredentialsDialog
          open
          onOpenChange={(open) => {
            if (!open) setReplacing(null);
          }}
          vm={replaced}
          onSubmit={(creds) => recreate(replaced, creds)}
        />
      ) : null}
    </>
  );
}
