import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Vm } from "../../model/types";
import {
  AutoStopField,
  initialAutoStopHours,
  parseAutoStopHours,
} from "./auto-stop-field";

interface StartVmDialogProps {
  /** The VM to start. The dialog is closed without it. */
  vm: Vm | null;
  onCancel: () => void;
  /** Without hours for a VM from before the registry: its auto-stop cannot change. */
  onConfirm: (vm: Vm, autoStopHours?: number) => void;
}

export function StartVmDialog({ vm, onCancel, onConfirm }: StartVmDialogProps) {
  return (
    <Dialog open={!!vm} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed by VM, so each opening starts from that VM's own value. */}
        {vm ? (
          <StartForm key={vm.id} vm={vm} onCancel={onCancel} onConfirm={onConfirm} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StartForm({
  vm,
  onCancel,
  onConfirm,
}: {
  vm: Vm;
  onCancel: () => void;
  onConfirm: (vm: Vm, autoStopHours?: number) => void;
}) {
  const [text, setText] = useState(() => initialAutoStopHours(vm.auto_stop_hours));
  const hours = parseAutoStopHours(text);
  const fixed = vm.registered === false;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (fixed) onConfirm(vm);
    else if (hours !== null) onConfirm(vm, hours);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Start {vm.name}?</DialogTitle>
        <DialogDescription>
          {fixed
            ? `It stops itself after ${initialAutoStopHours(vm.auto_stop_hours)} hours. Recreate the VM to change that.`
            : "Choose how long the VM runs before it stops itself."}
        </DialogDescription>
      </DialogHeader>
      {fixed ? null : (
        <AutoStopField id="start-auto-stop" value={text} onChange={setText} />
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!fixed && hours === null}>
          Start
        </Button>
      </DialogFooter>
    </form>
  );
}
