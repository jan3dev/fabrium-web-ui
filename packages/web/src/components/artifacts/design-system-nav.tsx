import { useState } from "react";
import { PencilIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type DesignSystemSectionInfo,
  isTokenSection,
  LIMITS,
  sectionLabel,
  type DesignSystemSection,
  type TokenSection,
} from "@/lib/artifacts/design-system";
import { readColor } from "@/lib/artifacts/styles";
import { cn } from "@/lib/utils";

const FIELD = "h-7 px-2 py-0 font-mono text-caption1";

const PLACEHOLDER: Record<TokenSection, string> = {
  colors: "rgb(51 85 255)",
  spacing: "8px",
  typography: "600 32px/1.2 Inter",
  radius: "12px",
  shadows: "0 1px 2px rgb(0 0 0 / 0.2)",
};

/** Name + value for one token section; the caller writes it into a version, or annotates without edit rights. */
function AddToken({
  section,
  onAdd,
}: {
  section: TokenSection;
  onAdd: (section: TokenSection, name: string, value: string) => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const label = sectionLabel(section).toLowerCase();
  const ready = name.trim() !== "" && value.trim() !== "";
  return (
    <form
      aria-label={`Add to ${label}`}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onAdd(section, name.trim(), value.trim());
        setName("");
        setValue("");
      }}
    >
      <Input
        aria-label="Name"
        placeholder="name"
        value={name}
        maxLength={LIMITS.name}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
        className={cn(FIELD, "w-28")}
      />
      {section === "colors" ? (
        <input
          type="color"
          aria-label="Pick a color"
          value={readColor(value).hex}
          onChange={(e) => setValue(e.target.value)}
          className="size-7 shrink-0 cursor-pointer rounded-utility border border-border bg-surface-secondary p-0.5"
        />
      ) : null}
      <Input
        aria-label="Value"
        placeholder={PLACEHOLDER[section]}
        value={value}
        maxLength={LIMITS.value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        className={cn(FIELD, "w-40 flex-1")}
      />
      <Button type="submit" size="xs" variant="secondary" disabled={!ready}>
        <PlusIcon />
        Add
      </Button>
    </form>
  );
}

/**
 * The section nav of a design-system artifact, above the panel's stage, plus the Add
 * control for token sections. The panel renders the stage (the markdown overview or the
 * sandboxed frame); nothing here renders agent markup. `onAdd` is undefined for agents,
 * which hides the Add control. `onEditChange` (users with edit rights) shows the Edit
 * toggle that puts the page in edit mode.
 */
export function DesignSystemNav({
  sections,
  section,
  onSectionChange,
  onAdd,
  editing = false,
  onEditChange,
}: {
  /** `designSystemSections(system)`: the panel computes them once. */
  sections: readonly DesignSystemSectionInfo[];
  section: DesignSystemSection;
  onSectionChange: (section: DesignSystemSection) => void;
  onAdd?: (section: TokenSection, name: string, value: string) => void;
  editing?: boolean;
  onEditChange?: (editing: boolean) => void;
}) {
  return (
    <div className="shrink-0" data-testid="design-system-nav">
      {/* Wraps instead of scrolling: eight sections do not fit a narrow panel on one line. */}
      <div className="flex items-start gap-2 border-b border-border px-3 py-2">
        <nav aria-label="Design system sections" className="flex min-w-0 flex-1 flex-wrap gap-1">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-current={s.key === section ? "true" : undefined}
              onClick={() => onSectionChange(s.key)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill px-2.5 text-caption1 font-medium transition-colors",
                s.key === section
                  ? "bg-surface-selected text-text-primary"
                  : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
              )}
            >
              {s.label}
              {s.key === "overview" ? null : <span className="text-text-tertiary tabular-nums">{s.count}</span>}
            </button>
          ))}
        </nav>
        {onEditChange ? (
          <Button
            size="xs"
            variant={editing ? "primary" : "utility"}
            aria-pressed={editing}
            onClick={() => onEditChange(!editing)}
          >
            {editing ? null : <PencilIcon />}
            {editing ? "Done" : "Edit"}
          </Button>
        ) : null}
      </div>
      {onAdd && isTokenSection(section) ? <AddToken key={section} section={section} onAdd={onAdd} /> : null}
    </div>
  );
}
