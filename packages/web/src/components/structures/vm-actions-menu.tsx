import { Fragment } from "react";
import { EllipsisIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Vm, VmState } from "../../model/types";

export type VmAction = "start" | "stop" | "reboot" | "credentials" | "delete";

const LABEL: Record<VmAction, string> = {
  start: "Start",
  stop: "Stop",
  reboot: "Reboot",
  credentials: "Update credentials",
  delete: "Delete",
};

// Update credentials and Delete are always offered. The other actions depend on the EC2 state.
// Delete is last in each list: the menu sets it apart, in the danger tone.
const ACTIONS: Record<VmState, VmAction[]> = {
  stopped: ["start", "credentials", "delete"],
  running: ["stop", "reboot", "credentials", "delete"],
  pending: ["credentials", "delete"],
  stopping: ["credentials", "delete"],
  "shutting-down": ["credentials", "delete"],
};

export interface VmActionsMenuProps {
  vm: Pick<Vm, "name" | "state">;
  /** An action of this VM is in flight: the trigger is disabled. */
  busy: boolean;
  onSelect: (action: VmAction) => void;
}

/** The actions that the state of a VM allows, in one menu. Delete comes last. */
export function VmActionsMenu({ vm, busy, onSelect }: VmActionsMenuProps) {
  const actions = ACTIONS[vm.state] ?? ["credentials", "delete"];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          aria-label={`Actions for ${vm.name}`}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <Fragment key={action}>
            {action === "delete" ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={action === "delete" ? "destructive" : "default"}
              // A menu that was open when an action started cannot start a second one.
              disabled={busy}
              onSelect={() => onSelect(action)}
            >
              {LABEL[action]}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
