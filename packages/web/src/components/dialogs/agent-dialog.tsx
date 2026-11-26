import { type FormEvent, type ReactNode, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { FabriumApiError } from "../../client/fabrium-api";
import { serverText } from "../../lib/fabrium-errors";
import type { Agent, AgentInput, AgentList, ModelList, Project } from "../../model/types";
import { ProjectSelector, projectGone } from "./project-selector";

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** The limit of the daemon and the control plane, in bytes of UTF-8. */
const MAX_DESCRIPTION_BYTES = 16384;

const LABEL = "text-body2 font-medium text-text-primary";
const HINT = "text-caption1 text-text-tertiary";

interface AgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null`: New agent. Otherwise Edit agent, with the fields its `can` flags allow. */
  agent: Agent | null;
  /** The VMs the caller can assign an agent to. */
  vms: AgentList["vms"];
  /** `null` while the list loads or when it failed. */
  models: ModelList | null;
  modelsError: string | null;
  /** The people of the workspace, from `GET /agents`: the owners to choose from. */
  members: { userId: string; name: string }[];
  /** `null` while the list loads or when it failed. */
  projects: Project[] | null;
  projectsError: string | null;
  /** `can.manage` of the project list: the selector offers Create project. */
  canManageProjects: boolean;
  /** Creates a project. Rejects with the reason it failed. */
  onCreateProject: (name: string) => Promise<Project>;
  /** Creates or changes the agent. Rejects with the reason it failed. */
  onSubmit: (input: AgentInput) => Promise<void>;
}

export function AgentDialog({ open, onOpenChange, agent, ...rest }: AgentDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      {/* Mounted while open and keyed by agent: each opening starts from the agent as it is. */}
      {open ? (
        <AgentForm
          key={agent?.id ?? "new"}
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

function AgentForm({
  agent,
  vms,
  models,
  modelsError,
  members,
  projects,
  projectsError,
  canManageProjects,
  onCreateProject,
  onSubmit,
  submitting,
  setSubmitting,
  close,
}: Omit<AgentDialogProps, "open" | "onOpenChange"> & {
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  close: () => void;
}) {
  // An edit compares against the agent as it was when the dialog opened, not against later polls.
  const [initial] = useState(agent);
  const [form, setForm] = useState({
    name: "",
    description: agent?.description ?? "",
    /** `null` until the user picks one: a new agent takes the default of the list. */
    model: agent?.model ?? null,
    tag: agent?.tag ?? "",
    owner: agent?.owner ?? "",
    vm: "",
  });
  const [projectId, setProjectId] = useState(agent?.project_id ?? null);
  const [failure, setFailure] = useState<{ message: string; step?: string } | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const name = form.name.trim();
  const model = form.model ?? models?.default ?? "";
  const tag = form.tag.trim();
  const nameError =
    !initial && name !== "" && !NAME_RE.test(name)
      ? "Use a lowercase letter first, then lowercase letters, digits, or hyphens. At most 32 characters."
      : undefined;
  const descriptionError =
    new TextEncoder().encode(form.description).length > MAX_DESCRIPTION_BYTES
      ? "The description is too long (max 16 KB)."
      : undefined;
  const showProject = !initial || initial.can.set_project;
  const gone = showProject && projectGone(projects, projectId);
  // A project agent that leaves its project: it needs an owner again.
  const takeOut = !!initial && initial.project_id !== null && projectId === null;
  const showOwner = projectId === null && (takeOut || !!initial?.can.set_owner);
  const showVm = !initial || (initial.vm === null && initial.can.assign);
  // A model the list no longer offers stays selectable, so an edit does not change it silently.
  const modelIds = [...new Set([...(models?.models.map((m) => m.id) ?? []), ...(model ? [model] : [])])];
  // A project agent runs only on a project VM.
  const usable = projectId === null ? vms : vms.filter((vm) => vm.project_id !== null);
  // A chosen VM that leaves the list stays an option, so the select shows what the request sends.
  const vmNames = [...new Set([...usable.map((vm) => vm.name), ...(form.vm ? [form.vm] : [])])];
  const noProjectVm = projectId !== null && usable.length === 0;
  const vmHint = noProjectVm
    ? "A project agent runs only on a project VM. No project VM is available."
    : form.vm
      ? "Every agent of a VM uses its Haven API key and its GitHub token."
      : undefined;
  const isPerson = members.some((m) => m.userId === form.owner);
  // A take-out offers only people; a personal agent keeps its owner as an option.
  const owner = takeOut && !isPerson ? "" : form.owner;
  const owners =
    isPerson || takeOut ? members : [{ userId: form.owner, name: form.owner }, ...members];
  const liveVm = initial?.vm?.state ? initial.vm.name : null;

  const pickProject = (next: string | null) => {
    setProjectId(next);
    // A personal VM that the project leaves out is no longer a choice.
    if (next !== null && form.vm && !usableFor(vms, form.vm)) set("vm", "");
  };

  let input: AgentInput;
  if (!initial) {
    input = {
      name,
      ...(form.description ? { description: form.description } : {}),
      model,
      ...(tag ? { tag } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      ...(form.vm ? { vm: form.vm } : {}),
    };
  } else {
    // Only what changed: a tag change must not resend a model that the Haven list may refuse.
    input = {};
    if (form.description !== (initial.description ?? "")) input.description = form.description;
    if (model !== initial.model) input.model = model;
    if (tag !== (initial.tag ?? "")) input.tag = tag;
    if (showProject && projectId !== initial.project_id) input.project_id = projectId ?? "";
    // A take-out always sends the owner, so what the user sees is what is stored.
    if (takeOut) input.owner = owner;
    else if (showOwner && form.owner !== (initial.owner ?? "")) input.owner = form.owner;
    if (showVm && form.vm) input.vm = form.vm;
  }
  const canSubmit =
    !submitting &&
    !descriptionError &&
    !gone &&
    !(takeOut && owner === "") &&
    (initial ? Object.keys(input).length > 0 : NAME_RE.test(name) && model !== "");
  const submitLabel = initial ? "Save" : "Create agent";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await onSubmit(input);
      setSubmitting(false);
      close();
    } catch (err) {
      setFailure({
        message: serverText(err),
        step: err instanceof FabriumApiError ? err.step : undefined,
      });
      setSubmitting(false);
    }
  };

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      // Without the restart note the dialog has no description.
      {...(liveVm ? {} : { "aria-describedby": undefined })}
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit agent" : "New agent"}</DialogTitle>
          {liveVm ? (
            <DialogDescription>
              A change of the description, the model, the owner, or the project
              restarts every agent of the VM {liveVm}. A turn in progress is lost.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {initial ? null : (
          <Field id="agent-name" label="Name" error={nameError}>
            <Input
              id="agent-name"
              aria-describedby={nameError ? "agent-name-error" : undefined}
              aria-invalid={!!nameError}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={submitting}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="reviewer"
            />
          </Field>
        )}
        <Field
          id="agent-description"
          label="Agent description"
          hint="The instructions of the agent. They become its AGENTS.md."
          error={descriptionError}
        >
          <Textarea
            id="agent-description"
            aria-describedby={
              descriptionError
                ? "agent-description-hint agent-description-error"
                : "agent-description-hint"
            }
            aria-invalid={!!descriptionError}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            disabled={submitting}
            rows={5}
            className="max-h-64"
          />
        </Field>
        <Field
          id="agent-model"
          label="Model"
          error={modelsError ? `Could not load the models. ${modelsError}` : undefined}
        >
          <NativeSelect
            id="agent-model"
            aria-describedby={modelsError ? "agent-model-error" : undefined}
            value={model}
            onChange={(e) => set("model", e.target.value)}
            disabled={submitting || models === null}
          >
            {model === "" ? (
              <option value="" disabled>
                {models === null && !modelsError ? "Loading models…" : "Select a model"}
              </option>
            ) : null}
            {modelIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="agent-tag" label="Tag">
          <Input
            id="agent-tag"
            value={form.tag}
            onChange={(e) => set("tag", e.target.value)}
            disabled={submitting}
            autoComplete="off"
            placeholder="Reviewer"
          />
        </Field>
        {showProject ? (
          <ProjectSelector
            id="agent-project"
            projects={projects}
            loadError={projectsError}
            value={projectId}
            fallbackName={initial?.project}
            onChange={pickProject}
            canCreate={canManageProjects}
            onCreate={onCreateProject}
            disabled={submitting}
          />
        ) : null}
        {showOwner ? (
          <Field
            id="agent-owner"
            label="Owner"
            hint={takeOut ? "The agent leaves the project. Choose who owns it." : undefined}
          >
            <NativeSelect
              id="agent-owner"
              aria-describedby={takeOut ? "agent-owner-hint" : undefined}
              value={owner}
              onChange={(e) => set("owner", e.target.value)}
              disabled={submitting}
            >
              {owner === "" ? (
                <option value="" disabled>
                  Choose an owner
                </option>
              ) : null}
              {owners.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name === m.userId ? m.userId : `${m.name} (${m.userId})`}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        {showVm ? (
          <Field id="agent-vm" label="VM" hint={vmHint}>
            <NativeSelect
              id="agent-vm"
              aria-describedby={vmHint ? "agent-vm-hint" : undefined}
              value={form.vm}
              onChange={(e) => set("vm", e.target.value)}
              disabled={submitting}
            >
              <option value="">No VM</option>
              {vmNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        {/* A gone project: the field says it. */}
        <Failure failure={gone ? null : failure} retry={submitLabel} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** A VM of the list that a project agent can use: a project VM. */
const usableFor = (vms: AgentList["vms"], name: string) =>
  vms.some((vm) => vm.name === name && vm.project_id !== null);

/** The reason a request failed, announced; with the step of a failed admission, which a retry resumes. */
export function Failure({
  failure,
  retry,
}: {
  failure: { message: string; step?: string } | null;
  /** The label of the button that retries. */
  retry: string;
}) {
  if (!failure) return null;
  return (
    <div role="alert" className="space-y-1 text-body2 text-accent-danger">
      <p>{failure.message}</p>
      {failure.step ? (
        <p>
          Failed at step: {failure.step}. Select {retry} to retry from that step.
        </p>
      ) : null}
    </div>
  );
}

/** A labelled form field with an optional hint and an announced error. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className={HINT}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption1 text-accent-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
