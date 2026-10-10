import type { PlanBoardEntry } from "@/events/zooid-events";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, ListChecksIcon } from "@/components/icons";
import type { PlanSnapshot } from "@/hooks/use-plan";
import { cn } from "@/lib/utils";

interface PlanBoardProps {
  plan: PlanSnapshot | null;
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onDismiss?: () => void;
}

export function PlanBoard({ plan, collapsed, onCollapse, onExpand, onDismiss }: PlanBoardProps) {
  if (!plan || plan.entries.length === 0) return null;
  const done = plan.entries.filter((e) => e.status === "completed").length;
  return (
    <div className="rounded-card border border-surface-border-primary bg-surface-secondary px-3 py-2">
      <div className="flex items-center gap-1.5 text-caption1 font-semibold text-text-secondary">
        <ListChecksIcon className="size-3.5 shrink-0" />
        <span>Plan</span>
        <span className="tabular-nums">
          {done}/{plan.entries.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label={collapsed ? "Expand plan" : "Collapse plan"}
            onClick={collapsed ? onExpand : onCollapse}
            className="rounded-utility p-0.5 hover:bg-surface-tertiary"
          >
            {collapsed ? <ChevronDownIcon className="size-3.5" /> : <ChevronUpIcon className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Dismiss plan"
            onClick={onDismiss}
            className="rounded-utility p-0.5 hover:bg-surface-tertiary"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      </div>
      {!collapsed && <PlanEntryList entries={plan.entries} className="mt-1" />}
    </div>
  );
}

export function PlanEntryList({ entries, className }: { entries: PlanBoardEntry[]; className?: string }) {
  return (
    <ul className={cn("space-y-0.5 text-body2", className)}>
      {entries.map((e, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={statusBullet(e.status)} role="img" aria-label={e.status} />
          <span className={e.status === "completed" ? "text-text-tertiary line-through" : "text-text-primary"}>
            {e.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

function statusBullet(status: string) {
  const base = "mt-1.5 inline-block size-2 shrink-0 rounded-full ";
  switch (status) {
    case "completed":
      return base + "bg-accent-success";
    case "in_progress":
      return base + "bg-accent-warning animate-pulse";
    case "failed":
    case "cancelled":
      return base + "bg-accent-danger";
    default:
      return base + "bg-text-tertiary";
  }
}
