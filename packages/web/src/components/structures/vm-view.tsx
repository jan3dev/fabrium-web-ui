import { type ReactNode, useEffect, useState } from "react";
import { PlusIcon, ShieldCheckIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAbsoluteTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Vm, VmState } from "../../model/types";

export type VmAction = "start" | "stop" | "reboot" | "delete";

const LABEL: Record<VmAction, string> = {
  start: "Start",
  stop: "Stop",
  reboot: "Reboot",
  delete: "Delete",
};

// Delete is always offered. The other actions depend on the EC2 state.
const ACTIONS: Record<VmState, VmAction[]> = {
  stopped: ["start", "delete"],
  running: ["stop", "reboot", "delete"],
  pending: ["delete"],
  stopping: ["delete"],
  "shutting-down": ["delete"],
};

const STATE_TONE: Record<VmState, "success" | "neutral" | "warning"> = {
  running: "success",
  stopped: "neutral",
  pending: "warning",
  stopping: "warning",
  "shutting-down": "warning",
};

const HEADERS = ["Name", "Agent", "Type", "State", "IP", "Launched"];

function launchedLabel(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : formatAbsoluteTime(ts);
}

interface VmViewProps {
  /** `null` until the first answer. */
  vms: Vm[] | null;
  /** The last error from loading the list. */
  error: string | null;
  /** The user is not an admin or an owner, or VM management is off. */
  noAccess: boolean;
  /** VMs with an action in flight. */
  busyIds: ReadonlySet<string>;
  onAction: (vm: Vm, action: VmAction) => void;
  /** Opens the New VM dialog. Without it, the button is not shown. */
  onNew?: () => void;
  onRetry: () => void;
}

export function VmView({
  vms,
  error,
  noAccess,
  busyIds,
  onAction,
  onNew,
  onRetry,
}: VmViewProps) {
  // The VM whose delete confirmation is open, by id.
  const [deleting, setDeleting] = useState<string | null>(null);
  const doomed = vms?.find((vm) => vm.id === deleting);

  // Forget a VM that left the list, so its return cannot bring back the confirmation.
  useEffect(() => {
    if (deleting && !doomed) setDeleting(null);
  }, [deleting, doomed]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <h1 className="font-heading text-subtitle font-medium">VMs</h1>
        {onNew && !noAccess ? (
          <Button size="sm" onClick={onNew}>
            <PlusIcon aria-hidden />
            New VM
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {noAccess ? (
          <Notice title="No access">
            Only workspace admins and owners can manage VMs. If you are one, VM
            management may be off for this workspace.
          </Notice>
        ) : vms === null ? (
          <FirstLoad error={error} onRetry={onRetry} />
        ) : vms.length === 0 ? (
          <Notice title="No VMs yet">Each VM runs one agent.</Notice>
        ) : (
          <>
            {error ? (
              <Alert tone="danger" className="mb-4">
                <p>Could not refresh the list. {error}</p>
              </Alert>
            ) : null}
            <VmTable
              vms={vms}
              busyIds={busyIds}
              onAction={onAction}
              onConfirmDelete={setDeleting}
            />
          </>
        )}
      </div>
      <AlertDialog
        open={!!doomed}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {doomed?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This terminates the VM and deletes its disk. The agent keeps its
              identity. You can't undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="utility"
                tone="danger"
                onClick={() => doomed && onAction(doomed, "delete")}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Before the first answer: loading, or the reason there is none. */
function FirstLoad({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  if (!error) {
    return (
      <p role="status" className="text-body2 text-text-secondary">
        Loading VMs…
      </p>
    );
  }
  return (
    <Alert tone="danger" className="items-center justify-between">
      <p>Could not load VMs. {error}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </Alert>
  );
}

function VmTable({
  vms,
  busyIds,
  onAction,
  onConfirmDelete,
}: {
  vms: Vm[];
  busyIds: ReadonlySet<string>;
  onAction: (vm: Vm, action: VmAction) => void;
  onConfirmDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-surface-border-primary">
      <table className="w-full min-w-[48rem] border-collapse text-left">
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
          {vms.map((vm) => (
            <VmRow
              key={vm.id}
              vm={vm}
              busy={busyIds.has(vm.id)}
              onAction={onAction}
              onConfirmDelete={() => onConfirmDelete(vm.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-surface-border-secondary px-6 py-10 text-center">
      <h2 className="font-heading text-subtitle font-medium text-text-primary">
        {title}
      </h2>
      <p className="max-w-md text-body2 text-text-secondary">{children}</p>
    </div>
  );
}

function VmRow({
  vm,
  busy,
  onAction,
  onConfirmDelete,
}: {
  vm: Vm;
  busy: boolean;
  onAction: (vm: Vm, action: VmAction) => void;
  onConfirmDelete: () => void;
}) {
  const expired = vm.setup === "expired";
  return (
    <tr className="border-t border-surface-border-primary align-top first:border-t-0">
      <th
        scope="row"
        className="px-4 py-3 text-left text-body2 font-medium text-text-primary"
      >
        {vm.name}
      </th>
      <td className="px-4 py-3 text-body2 break-all text-text-secondary">
        {vm.agent_id ?? "None"}
      </td>
      <td className="px-4 py-3">
        <span className="flex flex-wrap items-center gap-2 text-body2 text-text-primary">
          {vm.instance_type}
          {vm.sev_snp ? (
            <Badge tone="enclave">
              <ShieldCheckIcon aria-hidden />
              Confidential
            </Badge>
          ) : null}
        </span>
      </td>
      <td className="px-4 py-3">
        <Badge tone={STATE_TONE[vm.state] ?? "neutral"}>{vm.state}</Badge>
        <p
          className={cn(
            "mt-1 text-caption1",
            expired ? "text-accent-danger" : "text-text-secondary",
          )}
        >
          Setup {vm.setup}
          {expired ? ". Delete this VM and create it again." : null}
        </p>
      </td>
      <td className="px-4 py-3 text-body2 text-text-secondary">
        {vm.public_ip ?? "None"}
      </td>
      <td className="px-4 py-3 text-body2 text-text-secondary">
        <time dateTime={vm.launched_at}>{launchedLabel(vm.launched_at)}</time>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5">
          {(ACTIONS[vm.state] ?? ["delete"]).map((action) => (
            <Button
              key={action}
              type="button"
              size="xs"
              variant={action === "delete" ? "utility" : "secondary"}
              tone={action === "delete" ? "danger" : "default"}
              disabled={busy}
              aria-label={`${LABEL[action]} ${vm.name}`}
              onClick={() =>
                action === "delete" ? onConfirmDelete() : onAction(vm, action)
              }
            >
              {LABEL[action]}
            </Button>
          ))}
        </div>
      </td>
    </tr>
  );
}
