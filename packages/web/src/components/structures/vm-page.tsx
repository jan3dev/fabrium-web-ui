import { useState } from "react";
import { toast } from "sonner";
import {
  deleteVm,
  isNoAccess,
  rebootVm,
  startVm,
  stopVm,
} from "../../client/fabrium-api";
import { useVms } from "../../hooks/use-vms";
import type { Vm } from "../../model/types";
import { type VmAction, VmView } from "./vm-view";

const RUN = {
  start: startVm,
  stop: stopVm,
  reboot: rebootVm,
  delete: deleteVm,
} satisfies Record<VmAction, (id: string) => Promise<unknown>>;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The /vm route: the VM list and its row actions. */
export function VmRoute() {
  const { vms, error, refresh } = useVms();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const onAction = async (vm: Vm, action: VmAction) => {
    setBusyIds((ids) => new Set(ids).add(vm.id));
    try {
      await RUN[action](vm.id);
    } catch (e) {
      toast.error(`Could not ${action} ${vm.name}: ${messageOf(e)}`);
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

  return (
    <VmView
      vms={vms}
      error={error ? messageOf(error) : null}
      noAccess={isNoAccess(error)}
      busyIds={busyIds}
      onAction={onAction}
      onRetry={refresh}
    />
  );
}
