import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FabriumApiError } from "../../client/fabrium-api";
import type { Agent, CreateVmRequest, VmInstanceType } from "../../model/types";
import { Failure, Field } from "./agent-dialog";
import { AutoStopField, DEFAULT_AUTO_STOP_HOURS, parseAutoStopHours } from "./auto-stop-field";

/** The VM name rule of the daemon and the control plane. */
const VM_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const typeLabel = (t: VmInstanceType) =>
  `${t.name} · ${t.vcpus} vCPU · ${+(t.memory_mib / 1024).toFixed(1)} GiB${t.sev_snp ? " · Confidential" : ""}`;

interface CreateVmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent the VM is for. It has no live VM. */
  agent: Agent;
  /** `null` while they load or when they failed. */
  types: VmInstanceType[] | null;
  typesError: string | null;
  /** Creates the VM. Rejects with the reason it failed. */
  onSubmit: (req: CreateVmRequest) => Promise<void>;
}

export function CreateVmDialog({ open, onOpenChange, agent, ...rest }: CreateVmDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      {/* Mounted only while open: nothing typed here, secrets included, outlives the dialog. */}
      {open ? (
        <CreateVmForm
          key={agent.id}
          agent={agent}
          submitting={submitting}
          setSubmitting={setSubmitting}
          close={() => onOpenChange(false)}
          {...rest}
        />
      ) : null}
    </Dialog>
  );
}

function CreateVmForm({
  agent,
  types,
  typesError,
  onSubmit,
  submitting,
  setSubmitting,
  close,
}: Omit<CreateVmDialogProps, "open" | "onOpenChange"> & {
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  close: () => void;
}) {
  const [form, setForm] = useState({
    vmName: "",
    /** `null` means the default type. */
    instanceType: null as string | null,
    /** Typed text, so a half-typed value stays visible. */
    autoStopHours: String(DEFAULT_AUTO_STOP_HOURS),
    havenKey: "",
    githubToken: "",
  });
  const [failure, setFailure] = useState<{ message: string; step?: string } | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  // An agent with a VM name gets its VM back under that name.
  const fixed = agent.vm?.name;
  const vmName = fixed ?? form.vmName.trim();
  const nameError =
    !fixed && vmName !== "" && !VM_NAME_RE.test(vmName)
      ? "Use lowercase letters, digits, or hyphens, and start with a letter or a digit. At most 63 characters."
      : undefined;
  const instanceType = form.instanceType ?? types?.find((t) => t.default)?.name ?? "";
  const autoStopHours = parseAutoStopHours(form.autoStopHours);
  const havenKey = form.havenKey.trim();
  const githubToken = form.githubToken.trim();
  // The agent as the list shows it now: a refresh can take the right away, or give it a live VM.
  const canCreate =
    agent.can.create_vm &&
    types !== null &&
    VM_NAME_RE.test(vmName) &&
    autoStopHours !== null &&
    havenKey !== "" &&
    !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate || autoStopHours === null) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await onSubmit({
        agent: agent.id,
        name: vmName,
        ...(instanceType ? { instance_type: instanceType } : {}),
        auto_stop_hours: autoStopHours,
        haven_api_key: havenKey,
        ...(githubToken ? { github_token: githubToken } : {}),
      });
      setSubmitting(false);
      close();
    } catch (err) {
      setFailure({
        message: err instanceof Error ? err.message : String(err),
        step: err instanceof FabriumApiError ? err.step : undefined,
      });
      setSubmitting(false);
    }
  };

  const nameHint = fixed
    ? `This agent belongs to the VM ${fixed}. The other agents of that VM start with it.`
    : "Lowercase letters, digits, and hyphens.";

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      aria-describedby={undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>Create a VM for {agent.name}</DialogTitle>
        </DialogHeader>
        <Field id="vm-name" label="VM name" hint={nameHint} error={nameError}>
          <Input
            id="vm-name"
            aria-describedby={nameError ? "vm-name-hint vm-name-error" : "vm-name-hint"}
            aria-invalid={!!nameError}
            value={fixed ?? form.vmName}
            onChange={(e) => set("vmName", e.target.value)}
            readOnly={!!fixed}
            disabled={submitting}
            autoFocus={!fixed}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="lima"
          />
        </Field>
        {types ? (
          <Field id="vm-type" label="Instance type">
            <NativeSelect
              id="vm-type"
              value={instanceType}
              onChange={(e) => set("instanceType", e.target.value)}
              disabled={submitting}
            >
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {typeLabel(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : typesError ? (
          <Alert tone="danger" className="p-3 text-caption1">
            <p>Could not load the instance types. {typesError}</p>
          </Alert>
        ) : (
          <p role="status" className="text-body2 text-text-secondary">
            Loading instance types…
          </p>
        )}
        <AutoStopField
          id="vm-auto-stop"
          value={form.autoStopHours}
          onChange={(v) => set("autoStopHours", v)}
          disabled={submitting}
        />
        <SecretFields
          havenKey={form.havenKey}
          githubToken={form.githubToken}
          onChange={set}
          disabled={submitting}
        />
        <Failure failure={failure} retry="Create VM" />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canCreate}>
            Create VM
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** The two credentials of a VM. The browser must not offer to save or fill them. */
export function SecretFields({
  havenKey,
  githubToken,
  onChange,
  disabled,
}: {
  havenKey: string;
  githubToken: string;
  onChange: (key: "havenKey" | "githubToken", value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <Field id="haven-key" label="Haven API key">
        <Input
          id="haven-key"
          type="password"
          value={havenKey}
          onChange={(e) => onChange("havenKey", e.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field id="github-token" label="GitHub token">
        <Input
          id="github-token"
          type="password"
          value={githubToken}
          onChange={(e) => onChange("githubToken", e.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </>
  );
}
