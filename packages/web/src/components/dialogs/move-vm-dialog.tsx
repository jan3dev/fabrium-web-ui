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
import { NativeSelect } from "@/components/ui/native-select";
import { serverText } from "../../lib/fabrium-errors";
import type { Person, Project, Vm, VmOwnerInput } from "../../model/types";
import { Failure, Field } from "./agent-dialog";
import { ProjectSelector, ProjectVmNote, projectGone } from "./project-selector";

interface MoveVmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vm: Vm;
  /** `null` while the list loads or when it failed. */
  projects: Project[] | null;
  projectsError: string | null;
  /** `can.manage` of the project list: the selector offers Create project. */
  canManageProjects: boolean;
  /** Creates a project. Rejects with the reason it failed. */
  onCreateProject: (name: string) => Promise<Project>;
  /** The owners to choose from when the VM leaves its project; `null` while they load. */
  people: Person[] | null;
  /** Moves the VM. Rejects with the reason it failed. */
  onSubmit: (input: VmOwnerInput) => Promise<void>;
  /** Where the focus goes on close, when the control that opened the dialog is gone. */
  onCloseAutoFocus?: (event: Event) => void;
}

export function MoveVmDialog({ open, onOpenChange, vm, ...rest }: MoveVmDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      {/* Mounted while open and keyed by VM: each opening starts from the VM as it is. */}
      {open ? (
        <MoveVmForm
          key={vm.id}
          vm={vm}
          submitting={submitting}
          setSubmitting={setSubmitting}
          close={() => onOpenChange(false)}
          {...rest}
        />
      ) : null}
    </Dialog>
  );
}

function MoveVmForm({
  vm,
  projects,
  projectsError,
  canManageProjects,
  onCreateProject,
  people,
  onSubmit,
  onCloseAutoFocus,
  submitting,
  setSubmitting,
  close,
}: Omit<MoveVmDialogProps, "open" | "onOpenChange"> & {
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  close: () => void;
}) {
  const [projectId, setProjectId] = useState(vm.project_id);
  const [creator, setCreator] = useState(vm.creator ?? "");
  const [failure, setFailure] = useState<string | null>(null);

  const gone = projectGone(projects, projectId);
  // A project VM that leaves its project: it needs an owner again. Only an admin gets here.
  const takeOut = vm.project_id !== null && projectId === null;
  // The owner is a person, or the user chooses one.
  const owner = (people ?? []).some((p) => p.user_id === creator) ? creator : "";
  const canSubmit =
    !submitting && !gone && projectId !== vm.project_id && !(takeOut && owner === "");
  const restarts = vm.agents.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await onSubmit(projectId === null ? { project_id: "", owner } : { project_id: projectId });
      setSubmitting(false);
      close();
    } catch (err) {
      setFailure(serverText(err));
      setSubmitting(false);
    }
  };

  return (
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      onCloseAutoFocus={onCloseAutoFocus}
      // Without agents the dialog has no description.
      {...(restarts ? {} : { "aria-describedby": undefined })}
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>Move {vm.name} to a project</DialogTitle>
          {restarts ? (
            <DialogDescription>
              The agents of {vm.name} restart within about a minute. A turn in progress is lost.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <ProjectSelector
          id="move-project"
          projects={projects}
          loadError={projectsError}
          value={projectId}
          fallbackName={vm.project}
          onChange={setProjectId}
          canCreate={canManageProjects}
          onCreate={onCreateProject}
          disabled={submitting}
        />
        {projectId !== null ? <ProjectVmNote /> : null}
        {takeOut ? (
          <Field
            id="move-owner"
            label="Owner"
            hint="The VM leaves the project. Choose who owns it."
          >
            <NativeSelect
              id="move-owner"
              aria-describedby="move-owner-hint"
              value={owner}
              onChange={(e) => setCreator(e.target.value)}
              disabled={submitting}
            >
              {owner === "" ? (
                <option value="" disabled>
                  Choose an owner
                </option>
              ) : null}
              {(people ?? []).map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name === p.user_id ? p.user_id : `${p.name} (${p.user_id})`}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        {/* A gone project: the field says it. */}
        <Failure failure={failure && !gone ? { message: failure } : null} retry="Move VM" />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            Move VM
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
