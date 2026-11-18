import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFieldDraft } from "@/hooks/use-field-draft";
import {
  type DesignSystem,
  type DesignSystemSection,
  isTokenSection,
  LIMITS,
  type TokenSection,
} from "@/lib/artifacts/design-system";
import { readColor } from "@/lib/artifacts/styles";
import { cn } from "@/lib/utils";

const FIELD = "h-7 px-2 py-0 font-mono text-caption1";

/** A text field that reports its value once, on blur or Enter, and only when it changed (`useFieldDraft`). */
function Field({
  label,
  value,
  max,
  className,
  onCommit,
}: {
  label: string;
  value: string;
  max: number;
  className?: string;
  onCommit: (value: string) => void;
}) {
  const draft = useFieldDraft(value, onCommit);
  return (
    <Input
      aria-label={label}
      value={draft.text}
      maxLength={max}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => draft.change(e.target.value)}
      onBlur={draft.commit}
      onKeyDown={(e) => e.key === "Enter" && draft.commit()}
      className={cn(FIELD, className)}
    />
  );
}

/**
 * The design-system page in edit mode, for users who may write a version: the overview
 * text, each token's value and note, each component's note. Every field reports one
 * change on blur; the panel turns it into a version. Values are plain text here; only
 * the sandboxed section page renders them. Mount it per version (`key`), so a new
 * version resets the fields.
 */
export function DesignSystemEditor({
  system,
  section,
  onOverview,
  onToken,
  onComponent,
}: {
  system: DesignSystem;
  section: DesignSystemSection;
  onOverview: (text: string) => void;
  onToken: (section: TokenSection, name: string, field: "value" | "description", value: string) => void;
  onComponent: (name: string, description: string) => void;
}) {
  if (section === "overview") {
    return (
      <OverviewField value={system.overview} onCommit={onOverview} />
    );
  }
  if (section === "assets") {
    return <p className="p-4 text-body2 text-text-secondary">Ask the agent to change assets.</p>;
  }
  return (
    <ul className="flex h-full flex-col gap-2 overflow-y-auto p-3" aria-label="Values">
      {isTokenSection(section)
        ? system[section].map((t) => (
            <li key={t.name} className="flex flex-wrap items-center gap-2 rounded-card border border-border p-2">
              <span className="w-28 truncate text-caption1 font-medium" title={t.name}>
                {t.name}
              </span>
              {section === "colors" ? (
                <input
                  // Uncontrolled: a new value (typed, undone) must reset what it shows.
                  key={t.value}
                  type="color"
                  aria-label={`Pick a color for ${t.name}`}
                  defaultValue={readColor(t.value).hex}
                  onBlur={(e) => e.target.value !== readColor(t.value).hex && onToken(section, t.name, "value", e.target.value)}
                  className="size-7 shrink-0 cursor-pointer rounded-utility border border-border bg-surface-secondary p-0.5"
                />
              ) : null}
              <Field
                label={`Value of ${t.name}`}
                value={t.value}
                max={LIMITS.value}
                className="w-40 flex-1"
                onCommit={(v) => onToken(section, t.name, "value", v)}
              />
              <Field
                label={`Note for ${t.name}`}
                value={t.description ?? ""}
                max={LIMITS.description}
                className="w-full font-sans"
                onCommit={(v) => onToken(section, t.name, "description", v)}
              />
            </li>
          ))
        : system.components.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-2 rounded-card border border-border p-2">
              <span className="w-28 truncate text-caption1 font-medium" title={c.name}>
                {c.name}
              </span>
              <Field
                label={`Note for ${c.name}`}
                value={c.description ?? ""}
                max={LIMITS.description}
                className="flex-1 font-sans"
                onCommit={(v) => onComponent(c.name, v)}
              />
            </li>
          ))}
    </ul>
  );
}

function OverviewField({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const draft = useFieldDraft(value, onCommit);
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Textarea
        aria-label="Overview"
        value={draft.text}
        maxLength={LIMITS.overview}
        onChange={(e) => draft.change(e.target.value)}
        onBlur={draft.commit}
        className="min-h-0 flex-1 resize-none font-mono text-caption1"
      />
      <p className="text-caption1 text-text-tertiary">Markdown. Saved when you leave the field.</p>
    </div>
  );
}
