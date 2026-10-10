// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/activityRenderClasses/ActivityRow.tsx. Modified.
import * as React from "react";

import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type ActivityRowStats = {
  additions: number;
  deletions: number;
};

type ActivityRowProps = {
  children: React.ReactNode;
  className?: string;
  /** Open on mount. The row keeps whatever the user toggles after that. */
  defaultOpen?: boolean;
  testId?: string;
  title?: string;
};

type ActivityRowContentProps = {
  children: React.ReactNode;
  className?: string;
};

const ACTIVITY_ROW_CONTENT_MARKER = Symbol("ActivityRowContent");

type ActivityRowContentComponent = React.FC<ActivityRowContentProps> & {
  marker: typeof ACTIVITY_ROW_CONTENT_MARKER;
};

/**
 * A one-line activity summary. With an `ActivityRowContent` child it becomes a
 * disclosure; the content mounts only while open, so a long turn of closed
 * rows stays cheap.
 */
export function ActivityRow({
  children,
  className,
  defaultOpen = false,
  testId,
  title,
}: ActivityRowProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const childArray = React.Children.toArray(children);
  const summaryChildren = childArray.filter(
    (child) => !isActivityRowContent(child),
  );
  const contentChildren = childArray.filter(isActivityRowContent);

  if (contentChildren.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-6 min-w-0 items-center gap-1.5 text-text-secondary",
          className,
        )}
        data-testid={testId}
        title={title}
      >
        {children}
      </div>
    );
  }

  return (
    <details
      className={cn("w-full min-w-0", className)}
      data-testid={testId}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      open={open}
      title={title}
    >
      {/* Open state comes from React, not group-open: rows nest, and an open
          outer row would match every inner row's group-open. */}
      <summary
        className={cn(
          "group/row flex min-h-6 w-full max-w-full cursor-pointer list-none items-center gap-1.5 rounded-utility hover:text-text-primary [&::-webkit-details-marker]:hidden",
          open ? "text-text-primary" : "text-text-secondary",
        )}
      >
        {summaryChildren}
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-text-tertiary transition-transform group-hover/row:text-text-primary",
            open && "rotate-180",
          )}
        />
      </summary>
      {open
        ? contentChildren.map((child, index) => (
            <div className={child.props.className} key={index}>
              {child.props.children}
            </div>
          ))
        : null}
    </details>
  );
}

export function ActivityRowLabel({
  className,
  object,
  stats,
  title,
  verb,
}: {
  verb: string;
  object?: React.ReactNode;
  className?: string;
  stats?: ActivityRowStats | null;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-body2",
        className,
      )}
      title={title}
    >
      <span className="shrink-0 font-semibold">{verb}</span>
      {object ? (
        <span className="min-w-0 truncate font-mono text-caption1">
          {object}
        </span>
      ) : null}
      {stats ? <ActivityRowStatsView stats={stats} /> : null}
    </span>
  );
}

export const ActivityRowContent = (({ children }: ActivityRowContentProps) => (
  <>{children}</>
)) as ActivityRowContentComponent;
ActivityRowContent.marker = ACTIVITY_ROW_CONTENT_MARKER;

function ActivityRowStatsView({ stats }: { stats: ActivityRowStats }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-caption1 font-semibold tabular-nums">
      <span className="text-accent-success">+{stats.additions}</span>
      <span className="text-accent-danger">-{stats.deletions}</span>
    </span>
  );
}

function isActivityRowContent(
  child: React.ReactNode,
): child is React.ReactElement<
  ActivityRowContentProps,
  ActivityRowContentComponent
> {
  return (
    React.isValidElement(child) &&
    typeof child.type !== "string" &&
    "marker" in child.type &&
    child.type.marker === ACTIVITY_ROW_CONTENT_MARKER
  );
}
