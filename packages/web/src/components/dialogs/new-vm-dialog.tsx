import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FabriumApiError } from "../../client/fabrium-api";
import type {
  CreateVmRequest,
  VmFormOptions,
  VmInstanceType,
} from "../../model/types";

type Mode = "new" | "existing";

const MODES = [
  { value: "new", label: "New agent" },
  { value: "existing", label: "Existing agent" },
] as const;

const LABEL = "text-body2 font-medium text-text-primary";
const OPTIONAL = "text-caption1 font-normal text-text-tertiary";
const HINT = "text-caption1 text-text-tertiary";

interface FormState {
  mode: Mode;
  vmName: string;
  agentName: string;
  persona: string;
  project: string;
  /** Workstation of the chosen existing agent. */
  existing: string;
  /** `null` means the default type. */
  instanceType: string | null;
  havenKey: string;
  githubToken: string;
}

const EMPTY: FormState = {
  mode: "new",
  vmName: "",
  agentName: "",
  persona: "",
  project: "",
  existing: "",
  instanceType: null,
  havenKey: "",
  githubToken: "",
};

const typeLabel = (t: VmInstanceType) =>
  `${t.name} · ${t.vcpus} vCPU · ${+(t.memory_mib / 1024).toFixed(1)} GiB${t.sev_snp ? " · Confidential" : ""}`;

function buildRequest(f: FormState, instanceType: string): CreateVmRequest {
  const shared = {
    ...(instanceType ? { instance_type: instanceType } : {}),
    haven_api_key: f.havenKey.trim(),
    ...(f.githubToken.trim() ? { github_token: f.githubToken.trim() } : {}),
  };
  // The VM name is the workstation name, so an existing agent names its VM.
  if (f.mode === "existing") {
    return {
      name: f.existing,
      agent: { mode: "existing", name: f.existing },
      ...shared,
    };
  }
  const persona = f.persona.trim();
  const project = f.project.trim();
  return {
    name: f.vmName.trim(),
    agent: {
      mode: "new",
      name: f.agentName.trim(),
      ...(persona ? { persona } : {}),
      ...(project ? { project } : {}),
    },
    ...shared,
  };
}

interface NewVmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The instance types and agents to offer; `null` while they load. */
  options: VmFormOptions | null;
  /** Why the options did not load. */
  optionsError: string | null;
  /** Creates the VM. Rejects with the reason it failed. */
  onSubmit: (req: CreateVmRequest) => Promise<void>;
}

export function NewVmDialog({
  open,
  onOpenChange,
  options,
  optionsError,
  onSubmit,
}: NewVmDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; step?: string } | null>(
    null,
  );

  const reset = useCallback(() => {
    setForm(EMPTY);
    setSubmitting(false);
    setFailure(null);
  }, []);

  // Nothing typed here, secrets included, outlives the dialog, whoever closes it.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const freeAgents = options?.agents.filter((a) => a.free) ?? [];
  const chosen = freeAgents.find((a) => a.workstation === form.existing);
  const instanceType =
    form.instanceType ??
    options?.instanceTypes.find((t) => t.default)?.name ??
    "";
  const named =
    form.mode === "new"
      ? form.vmName.trim() !== "" && form.agentName.trim() !== ""
      : chosen !== undefined;
  const canCreate =
    options !== null && named && form.havenKey.trim() !== "" && !submitting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await onSubmit(buildRequest(form, instanceType));
      reset();
      onOpenChange(false);
    } catch (err) {
      setFailure({
        message: err instanceof Error ? err.message : String(err),
        step: err instanceof FabriumApiError ? err.step : undefined,
      });
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        data-testid="new-vm-dialog"
      >
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New VM</DialogTitle>
            <DialogDescription>Run an agent on its own VM.</DialogDescription>
          </DialogHeader>
          <SegmentedControl
            legend="New or existing agent"
            options={MODES}
            value={form.mode}
            onValueChange={(mode) => set("mode", mode)}
            disabled={submitting}
            className="w-full"
            testId="new-vm-mode"
            optionTestIdPrefix="new-vm-mode"
          />
          {form.mode === "new" ? (
            <>
              <Field
                id="vm-name"
                label="VM name"
                hint="Lowercase letters, digits, and hyphens."
              >
                <Input
                  id="vm-name"
                  aria-describedby="vm-name-hint"
                  value={form.vmName}
                  onChange={(e) => set("vmName", e.target.value)}
                  disabled={submitting}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="lima"
                />
              </Field>
              <Field
                id="agent-name"
                label="Agent name"
                hint="Lowercase letters, digits, and hyphens. Start with a letter."
              >
                <Input
                  id="agent-name"
                  aria-describedby="agent-name-hint"
                  value={form.agentName}
                  onChange={(e) => set("agentName", e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="echo"
                />
              </Field>
              <Field id="agent-persona" label="Persona" optional>
                <Input
                  id="agent-persona"
                  value={form.persona}
                  onChange={(e) => set("persona", e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                  placeholder="Reviewer"
                />
              </Field>
              <Field id="agent-project" label="Project" optional>
                <Input
                  id="agent-project"
                  value={form.project}
                  onChange={(e) => set("project", e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                  placeholder="Fabrium"
                />
              </Field>
            </>
          ) : options ? (
            freeAgents.length === 0 ? (
              <p className="text-body2 text-text-secondary">
                No agent is free. Create a new agent instead.
              </p>
            ) : (
              <Field
                id="vm-agent"
                label="Agent"
                hint={chosen ? `The VM is named ${chosen.workstation}.` : undefined}
              >
                <NativeSelect
                  id="vm-agent"
                  aria-describedby={chosen ? "vm-agent-hint" : undefined}
                  value={form.existing}
                  onChange={(e) => set("existing", e.target.value)}
                  disabled={submitting}
                >
                  <option value="">Select an agent</option>
                  {freeAgents.map((agent) => (
                    <option key={agent.workstation} value={agent.workstation}>
                      {agent.agent_id}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )
          ) : null}
          {options ? (
            <Field id="vm-type" label="Instance type">
              <NativeSelect
                id="vm-type"
                value={instanceType}
                onChange={(e) => set("instanceType", e.target.value)}
                disabled={submitting}
              >
                {options.instanceTypes.map((t) => (
                  <option key={t.name} value={t.name}>
                    {typeLabel(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : optionsError ? (
            <Alert tone="danger" className="p-3 text-caption1">
              <p>Could not load the options. {optionsError}</p>
            </Alert>
          ) : (
            <p role="status" className="text-body2 text-text-secondary">
              Loading options…
            </p>
          )}
          <Field id="haven-key" label="Haven API key">
            <Input
              id="haven-key"
              type="password"
              value={form.havenKey}
              onChange={(e) => set("havenKey", e.target.value)}
              disabled={submitting}
              autoComplete="new-password"
              spellCheck={false}
            />
          </Field>
          <Field id="github-token" label="GitHub token" optional>
            <Input
              id="github-token"
              type="password"
              value={form.githubToken}
              onChange={(e) => set("githubToken", e.target.value)}
              disabled={submitting}
              autoComplete="new-password"
              spellCheck={false}
            />
          </Field>
          {failure ? (
            <div role="alert" className="space-y-1 text-body2 text-accent-danger">
              <p>{failure.message}</p>
              {failure.step ? (
                <p>
                  Failed at step: {failure.step}. Select Create VM to retry from
                  that step.
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={!canCreate}>
              {submitting ? "Creating…" : "Create VM"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  optional,
  hint,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className={LABEL} htmlFor={id}>
        {label}
        {optional ? (
          <>
            {" "}
            <span className={OPTIONAL}>Optional</span>
          </>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className={HINT}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
