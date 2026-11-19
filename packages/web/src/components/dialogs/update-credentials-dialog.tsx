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
import type { Vm, VmCredentials } from "../../model/types";
import { Failure } from "./agent-dialog";
import { SecretFields } from "./create-vm-dialog";

interface UpdateCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vm: Vm;
  /** Replaces the VM. Rejects with the reason it failed. */
  onSubmit: (creds: VmCredentials) => Promise<void>;
}

export function UpdateCredentialsDialog({
  open,
  onOpenChange,
  vm,
  onSubmit,
}: UpdateCredentialsDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      {/* Mounted only while open: no secret outlives the dialog. */}
      {open ? (
        <CredentialsForm
          key={vm.id}
          vm={vm}
          onSubmit={onSubmit}
          submitting={submitting}
          setSubmitting={setSubmitting}
          close={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function CredentialsForm({
  vm,
  onSubmit,
  submitting,
  setSubmitting,
  close,
}: Pick<UpdateCredentialsDialogProps, "vm" | "onSubmit"> & {
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  close: () => void;
}) {
  const [form, setForm] = useState({ havenKey: "", githubToken: "" });
  const [failure, setFailure] = useState<{ message: string } | null>(null);
  const havenKey = form.havenKey.trim();
  const githubToken = form.githubToken.trim();
  const canSubmit = havenKey !== "" && !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await onSubmit({
        haven_api_key: havenKey,
        ...(githubToken ? { github_token: githubToken } : {}),
      });
      setSubmitting(false);
      close();
    } catch (err) {
      setFailure({ message: err instanceof Error ? err.message : String(err) });
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>Update the credentials of {vm.name}</DialogTitle>
          <DialogDescription>
            This deletes the VM and creates it again with the same name. The files on
            the VM are lost. Every agent of the VM stops until the new VM is ready.
          </DialogDescription>
        </DialogHeader>
        <SecretFields
          havenKey={form.havenKey}
          githubToken={form.githubToken}
          onChange={(key, value) => setForm((f) => ({ ...f, [key]: value }))}
          disabled={submitting}
        />
        <Failure failure={failure} retry="Replace VM" />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="utility" tone="danger" disabled={!canSubmit}>
            Replace VM
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
