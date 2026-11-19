import { type FormEvent, useEffect, useId, useRef, useState } from "react";
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
import { SERVER_TEXT, projectNameText } from "../../lib/fabrium-errors";
import { projectNameError } from "../../lib/project-name";
import type { Project } from "../../model/types";
import { Failure } from "./agent-dialog";

interface ManageProjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` while the list loads or when it failed. */
  projects: Project[] | null;
  /** The load error. */
  error: string | null;
  /** Rejects with the reason it failed. */
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Rename a project, or delete one that nothing belongs to. For an admin. */
export function ManageProjectsDialog({
  open,
  onOpenChange,
  projects,
  error,
  onRename,
  onDelete,
}: ManageProjectsDialogProps) {
  const baseId = useId();
  /** The project whose name is being edited, and the typed name. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // After a rename ends, the focus returns to the Rename button of its row.
  const returnTo = useRef<string | null>(null);
  const renameId = (id: string) => `${baseId}-rename-${id}`;

  useEffect(() => {
    if (renaming || !returnTo.current) return;
    document.getElementById(renameId(returnTo.current))?.focus();
    returnTo.current = null;
  });

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
      return true;
    } catch (e) {
      setFailure(projectNameText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const endRename = () => {
    returnTo.current = renaming?.id ?? null;
    setRenaming(null);
    setFailure(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        if (!next) {
          setRenaming(null);
          setFailure(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
        // Escape in a rename ends the rename, not the dialog.
        onEscapeKeyDown={(e) => {
          if (!renaming) return;
          e.preventDefault();
          if (!busy) endRename();
        }}
      >
        <DialogHeader>
          <DialogTitle>Manage projects</DialogTitle>
          <DialogDescription>Rename a project, or delete one that nothing belongs to.</DialogDescription>
        </DialogHeader>
        {projects === null ? (
          error ? (
            <Alert tone="danger" className="p-3 text-caption1">
              <p>Could not load the projects. {error}</p>
            </Alert>
          ) : (
            <p role="status" className="text-body2 text-text-secondary">
              Loading projects…
            </p>
          )
        ) : projects.length === 0 ? (
          <p className="text-body2 text-text-secondary">
            No projects yet. Create one from the Project field of an agent.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border-primary rounded-card border border-surface-border-primary">
            {projects.map((project) =>
              renaming?.id === project.id ? (
                <RenameRow
                  key={project.id}
                  project={project}
                  name={renaming.name}
                  onName={(name) => setRenaming({ id: project.id, name })}
                  busy={busy}
                  onSave={async (name) => {
                    if (await run(() => onRename(project.id, name))) endRename();
                  }}
                  onCancel={endRename}
                />
              ) : (
                <ProjectRow
                  key={project.id}
                  project={project}
                  renameId={renameId(project.id)}
                  busy={busy}
                  onRename={() => {
                    setFailure(null);
                    setRenaming({ id: project.id, name: project.name });
                  }}
                  onDelete={() => void run(() => onDelete(project.id))}
                />
              ),
            )}
          </ul>
        )}
        <Failure failure={failure ? { message: failure } : null} retry="" />
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectRow({
  project,
  renameId,
  busy,
  onRename,
  onDelete,
}: {
  project: Project;
  renameId: string;
  busy: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  // Shown as text: a disabled button gets no pointer, focus, or touch, so a tooltip never shows.
  const reasonId = useId();
  return (
    <li className="px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 break-all text-body2 text-text-primary">{project.name}</span>
        <div className="flex shrink-0 gap-1.5">
          <Button
            id={renameId}
            type="button"
            size="xs"
            variant="secondary"
            aria-label={`Rename ${project.name}`}
            disabled={busy}
            onClick={onRename}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="xs"
            variant="utility"
            tone="danger"
            aria-label={`Delete ${project.name}`}
            aria-describedby={project.in_use ? reasonId : undefined}
            disabled={busy || project.in_use}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
      {project.in_use ? (
        <p id={reasonId} className="mt-1 text-right text-caption1 text-text-secondary">
          {SERVER_TEXT["project in use"]}
        </p>
      ) : null}
    </li>
  );
}

function RenameRow({
  project,
  name,
  onName,
  busy,
  onSave,
  onCancel,
}: {
  project: Project;
  name: string;
  onName: (name: string) => void;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const errorId = useId();
  const trimmed = name.trim();
  const ruleError = projectNameError(name);
  const canSave = !busy && !ruleError && trimmed !== project.name;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave) onSave(trimmed);
  };
  return (
    <li className="px-3 py-2">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <Input
          aria-label={`Name of ${project.name}`}
          aria-describedby={ruleError ? errorId : undefined}
          aria-invalid={!!ruleError}
          value={name}
          onChange={(e) => onName(e.target.value)}
          disabled={busy}
          autoFocus
          autoComplete="off"
          className="h-7 min-w-0 flex-1"
        />
        <Button type="submit" size="xs" disabled={!canSave}>
          Save
        </Button>
        <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </form>
      {ruleError ? (
        <p id={errorId} className="mt-1 text-caption1 text-accent-danger">
          {ruleError}
        </p>
      ) : null}
    </li>
  );
}
