import { useRef, useState } from "react";
import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { Alert } from "@/components/ui/alert";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SERVER_TEXT, projectNameText } from "../../lib/fabrium-errors";
import { projectNameError, sameProjectName } from "../../lib/project-name";
import type { Project } from "../../model/types";
import { Field } from "./agent-dialog";

// Item values that no project id (32 hex characters) can have.
const NONE = ":none";
const CREATE = ":create";
const SEARCH = "Search or create a project";
const NOTE = "px-2.5 py-1.5 text-body2 text-text-secondary";

/** A selected project that the loaded list lacks: another admin deleted it. */
export function projectGone(projects: Project[] | null, value: string | null): boolean {
  return projects !== null && value !== null && !projects.some((p) => p.id === value);
}

interface ProjectSelectorProps {
  /** The id of the trigger; the label points at it. */
  id: string;
  /** `null` while loading, or when it failed. */
  projects: Project[] | null;
  loadError: string | null;
  /** A project id, or null for No project. */
  value: string | null;
  /** The name to show while `projects` is null. */
  fallbackName?: string | null;
  onChange: (projectId: string | null) => void;
  /** `can.manage` of the project list. */
  canCreate: boolean;
  /** Rejects with the reason it failed. */
  onCreate: (name: string) => Promise<Project>;
  /** "No project" cannot be picked. */
  noneDisabled?: boolean;
  /** The reason, or a note, under the field. */
  hint?: string;
  disabled?: boolean;
}

/**
 * The Project field: a trigger that shows the value, and a list to search, pick, or create a
 * project. The list filters itself, so the case rule of project names is ours, not cmdk's.
 */
export function ProjectSelector({
  id,
  projects,
  loadError,
  value,
  fallbackName,
  onChange,
  canCreate,
  onCreate,
  noneDisabled = false,
  hint,
  disabled = false,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The names seen, so a project that was deleted keeps its name on the trigger.
  const names = useRef(new Map<string, string>());
  for (const p of projects ?? []) names.current.set(p.id, p.name);

  const typed = query.trim();
  const shown = (projects ?? []).filter((p) =>
    p.name.toLowerCase().includes(typed.toLowerCase()),
  );
  const taken = (projects ?? []).some((p) => sameProjectName(p.name, typed));
  const ruleError = canCreate && typed !== "" && !taken ? projectNameError(typed) : null;
  // Last in the list: Enter on a name that matches a project picks it, never creates.
  const offerCreate = canCreate && typed !== "" && !taken && !ruleError;
  const showNone = typed === "";

  const error =
    createError ??
    (loadError
      ? `Could not load the projects. ${loadError}`
      : projectGone(projects, value)
        ? SERVER_TEXT["unknown project"]
        : undefined);
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const name = value === null ? null : (names.current.get(value) ?? fallbackName ?? null);
  const label =
    name ??
    (projects === null && !loadError ? "Loading projects…" : value === null ? "No project" : "");

  const setList = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setCreateError(null);
    }
  };
  const pick = (projectId: string | null) => {
    onChange(projectId);
    setList(false);
  };
  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const project = await onCreate(typed);
      pick(project.id);
    } catch (e) {
      setCreateError(projectNameText(e));
    } finally {
      // In the same render as the close: the focus returns to an enabled trigger.
      setCreating(false);
    }
  };

  return (
    <Field id={id} label="Project" hint={hint} error={error}>
      <Popover open={open} onOpenChange={setList}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-describedby={describedBy}
            disabled={disabled || creating || projects === null}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && !open) {
                e.preventDefault();
                setList(true);
              }
            }}
            className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-utility border border-surface-border-secondary bg-surface-secondary px-3 py-2 text-left text-body2 text-text-primary transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="truncate">{label}</span>
            <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-text-secondary" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Project"
          className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        >
          <Command shouldFilter={false} label={SEARCH}>
            <CommandInput
              placeholder={SEARCH}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setCreateError(null);
              }}
            />
            {/* Rendered when empty too: the search field names it in aria-controls. */}
            <CommandList>
              {showNone ? (
                <CommandItem
                  value={NONE}
                  disabled={noneDisabled || creating}
                  data-checked={value === null}
                  onSelect={() => pick(null)}
                >
                  No project
                </CommandItem>
              ) : null}
              {shown.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  disabled={creating}
                  data-checked={value === p.id}
                  onSelect={() => pick(p.id)}
                >
                  <span className="truncate">{p.name}</span>
                </CommandItem>
              ))}
              {offerCreate ? (
                <CommandItem value={CREATE} disabled={creating} onSelect={() => void create()}>
                  <PlusIcon aria-hidden />
                  <span className="truncate">{`Create project "${typed}"`}</span>
                </CommandItem>
              ) : null}
            </CommandList>
            {ruleError ? (
              <p className="px-2.5 py-1.5 text-caption1 text-accent-danger">{ruleError}</p>
            ) : shown.length === 0 && !showNone && !offerCreate ? (
              <p className={NOTE}>No projects match</p>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}

/** Who can use the credentials of a project VM. Shown in Create VM and Move to project. */
export function ProjectVmNote() {
  return (
    <Alert role="status" className="p-3 text-caption1">
      <p>
        Every member with a role can run agents on this VM, with its Haven API key and its GitHub
        token. Use credentials made for the project, not for one person.
      </p>
    </Alert>
  );
}
