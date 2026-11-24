import {
  ChevronDownIcon,
  CloseIcon,
  FrameIcon,
  MotionIcon,
  PaletteIcon,
  PresentationIcon,
  ShapesIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CREATE_TYPES, type CreateType, createLabel } from "@/lib/artifacts/hint";

const ICON: Record<CreateType, typeof FrameIcon> = {
  slides: PresentationIcon,
  design: FrameIcon,
  "design-system": PaletteIcon,
  whiteboard: ShapesIcon,
  motion: MotionIcon,
};

/**
 * The composer's Create menu (spec §6.8): the next message asks the agent for this kind
 * of artifact. Whiteboard and Motion are listed but marked "Not available yet": the
 * request still goes out and the agent answers that it cannot make them yet.
 */
export function CreateMenu({ value, onPick }: { value: CreateType | null; onPick: (type: CreateType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="tertiary">
          Create
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {CREATE_TYPES.map((t) => {
          const Icon = ICON[t.type];
          return (
            <DropdownMenuItem
              key={t.type}
              onSelect={() => onPick(t.type)}
              aria-current={value === t.type ? "true" : undefined}
              className="items-start"
            >
              <Icon className="mt-0.5" />
              <span className="flex min-w-0 flex-col">
                <span className="text-body2 text-text-primary">{t.label}</span>
                <span className="text-caption1 text-text-secondary">{t.description}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The kind the next message asks for, over the field; removable. */
export function CreateChip({ type, onRemove }: { type: CreateType; onRemove: () => void }) {
  const Icon = ICON[type];
  return (
    <div
      data-testid="create-chip"
      className="mb-2 inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-secondary py-0.5 pr-1 pl-2.5 text-caption1 text-text-primary"
    >
      <Icon className="size-3.5 text-text-tertiary" />
      Create: {createLabel(type)}
      <button
        type="button"
        aria-label={`Remove ${createLabel(type)}`}
        onClick={onRemove}
        className="rounded-pill p-0.5 text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </div>
  );
}
