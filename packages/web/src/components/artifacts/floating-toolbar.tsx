import { CopyIcon, FillIcon, TextColorIcon, TrashIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Box } from "@/lib/artifacts/canvas";
import { num, readColor, type Styles } from "@/lib/artifacts/styles";

const HEIGHT = 40;

/**
 * Over the canvas selection while Properties is closed (spec §6.1): the five most used
 * controls. `rect` is the selection in the stage's coordinates. On a phone only Delete
 * (spec §6.1): leave out `onChange` and `onDuplicate`.
 */
export function FloatingToolbar({
  rect,
  values,
  onChange,
  onDuplicate,
  onDelete,
}: {
  rect: Box;
  values: Styles;
  onChange?: (changes: Styles) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
}) {
  // Above the selection, or under it when there is no room.
  const top = rect.y >= HEIGHT + 8 ? rect.y - HEIGHT - 8 : rect.y + rect.h + 8;
  const color = (label: string, icon: React.ReactNode, prop: "background-color" | "color") => (
    <label className="flex items-center gap-1 rounded-utility px-1 text-text-tertiary hover:bg-surface-secondary">
      {icon}
      <input
        type="color"
        aria-label={label}
        value={readColor(values[prop]).hex}
        onChange={(e) => onChange?.({ [prop]: e.target.value })}
        className="size-6 cursor-pointer rounded-utility border border-border bg-surface-secondary p-0.5"
      />
    </label>
  );
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      data-testid="floating-toolbar"
      // Placed at the selection: a position, not a colour.
      style={{ left: Math.max(8, rect.x), top: Math.max(8, top) }}
      className="absolute z-10 flex h-10 items-center gap-1 rounded-card border border-border bg-surface-primary p-1 shadow-surface"
    >
      {onChange ? (
        <>
          {color("Fill", <FillIcon className="size-3.5" />, "background-color")}
          {color("Text color", <TextColorIcon className="size-3.5" />, "color")}
          <Input
            type="number"
            aria-label="Font size"
            min={1}
            value={num(values["font-size"])}
            onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange({ "font-size": `${e.target.valueAsNumber}px` })}
            className="h-7 w-16 px-2 py-0 text-caption1"
          />
        </>
      ) : null}
      {onDuplicate ? <IconButton size="small" icon={<CopyIcon />} label="Duplicate" onClick={onDuplicate} /> : null}
      <IconButton size="small" tone="danger" icon={<TrashIcon />} label="Delete" onClick={onDelete} />
    </div>
  );
}
