import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createProject,
  deleteVm,
  isNoAccess,
  rebootVm,
  recreateVm,
  setAutoStop,
  setVmOwner,
  startVm,
  stopVm,
} from "../../client/fabrium-api";
import { usePeople } from "../../hooks/use-people";
import { useProjects } from "../../hooks/use-projects";
import { useVms } from "../../hooks/use-vms";
import type { Vm, VmCredentials, VmOwnerInput } from "../../model/types";
import { MoveVmDialog } from "../dialogs/move-vm-dialog";
import { UpdateCredentialsDialog } from "../dialogs/update-credentials-dialog";
import { type VmAction, VmView } from "./vm-view";

const RUN = {
  start: startVm,
  stop: stopVm,
  reboot: rebootVm,
  delete: deleteVm,
} satisfies Record<
  Exclude<VmAction, "credentials" | "project">,
  (id: string, autoStopHours?: number) => Promise<unknown>
>;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The menu item that opened a dialog is gone: on close, the focus returns to the menu of the row. */
const focusMenuOf = (vm: Vm) => (e: Event) => {
  const trigger = document.querySelector<HTMLElement>(
    `[data-vm-id="${CSS.escape(vm.id)}"] [aria-haspopup="menu"]`,
  );
  if (!trigger) return;
  e.preventDefault();
  trigger.focus();
};

/**
 * The /vm route: the VM list, its row actions, and the Update credentials and Move dialogs.
 * A VM is created from an agent, on the Agents page.
 */
export function VmRoute() {
  const { vms, error, refresh } = useVms();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  // The VM whose Update credentials dialog is open, by id.
  const [replacing, setReplacing] = useState<string | null>(null);
  const replaced = vms?.find((vm) => vm.id === replacing);
  // The VM whose Move to project dialog is open, by id.
  const [moving, setMoving] = useState<string | null>(null);
  const moved = vms?.find((vm) => vm.id === moving);
  const projects = useProjects(moving !== null);
  // Only a take-out needs the people: an admin, on a project VM.
  const { people } = usePeople(moving !== null && !!moved?.project_id && moved.can.set_project);

  // Forget a VM that left the list, so its return cannot bring back the dialog.
  useEffect(() => {
    if (replacing && !replaced) setReplacing(null);
  }, [replacing, replaced]);
  useEffect(() => {
    if (moving && !moved) setMoving(null);
  }, [moving, moved]);

  const createProjectFor = async (name: string) => {
    const project = await createProject(name);
    projects.add(project);
    return project;
  };
  const move = async (vm: Vm, input: VmOwnerInput) => {
    try {
      await setVmOwner(vm.id, input);
    } catch (e) {
      // Another admin deleted the project: the dialog shows it once the list has it gone.
      if (e instanceof Error && e.message === "unknown project") await projects.refresh();
      throw e;
    } finally {
      refresh();
    }
  };

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
      : action === "project"
        ? setMoving(vm.id)
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
      {moved ? (
        <MoveVmDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoving(null);
          }}
          vm={moved}
          projects={projects.list?.projects ?? null}
          projectsError={projects.error}
          canManageProjects={projects.list?.can.manage ?? false}
          onCreateProject={createProjectFor}
          people={people}
          onSubmit={(input) => move(moved, input)}
          onCloseAutoFocus={focusMenuOf(moved)}
        />
      ) : null}
    </>
  );
}
