import { AppWindowIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PreviewEvent, PreviewStatus } from "@/model/types";

const STATUS: Record<
  PreviewStatus,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  starting: { label: "Starting", tone: "warning" },
  running: { label: "Running", tone: "success" },
  crashed: { label: "Crashed", tone: "danger" },
  stopped: { label: "Stopped", tone: "neutral" },
  offline: { label: "Offline", tone: "neutral" },
};

export function PreviewStatusBadge({ status }: { status: PreviewStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <Badge tone={tone} data-testid="preview-status">
      {label}
    </Badge>
  );
}

/** The row a preview event gets in its thread. Opens the preview panel. */
export function PreviewCard({
  preview,
  active = false,
  onOpen,
}: {
  preview: PreviewEvent;
  /** The panel shows this preview. */
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="preview-card"
      aria-label={`Open preview: ${preview.title}`}
      aria-pressed={active}
      onClick={onOpen}
      className={cn(
        "flex w-full max-w-md cursor-pointer items-center gap-3 rounded-card border bg-surface-secondary py-2.5 pr-4 pl-3 text-left transition-colors",
        active
          ? "border-accent-brand"
          : "border-surface-border-primary hover:border-surface-border-secondary",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-utility bg-surface-tertiary text-text-secondary">
        <AppWindowIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body2 font-medium text-text-primary">
          {preview.title}
        </span>
        <span className="block truncate font-mono text-caption1 text-text-tertiary">
          {preview.command || "Live preview"}
        </span>
      </span>
      {/* ponytail: the event's action, not live status; the panel polls. Live status here needs one poll per room. */}
      <span className="shrink-0 text-caption1 text-text-tertiary">
        {preview.action === "started" ? "Open preview" : "App stopped"}
      </span>
    </button>
  );
}
