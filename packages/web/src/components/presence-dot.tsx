// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/presence/ui/PresenceBadge.tsx. Modified.
import type * as React from "react";

import type { PresenceState } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";

export type PresenceStatus = "online" | "away" | "offline";

/** Matrix presence → the three states the UI shows. */
export function toPresenceStatus(
  presence: PresenceState["presence"],
): PresenceStatus {
  return presence === "unavailable" ? "away" : presence;
}

const DOT_CLASS: Record<PresenceStatus, string> = {
  online: "bg-accent-success",
  away: "bg-accent-warning",
  offline: "bg-text-tertiary",
};

const CHIP_CLASS: Record<PresenceStatus, string> = {
  online: "bg-accent-success-transparent text-accent-success",
  away: "bg-accent-warning-transparent text-accent-warning",
  offline: "bg-surface-tertiary text-text-secondary",
};

const LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
};

export function PresenceDot({
  status,
  className,
  ...props
}: {
  status: PresenceStatus;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      data-presence={status}
      className={cn(
        "inline-flex size-2.5 shrink-0 rounded-full",
        DOT_CLASS[status],
        className,
      )}
      {...props}
    />
  );
}

export function PresenceBadge({
  status,
  className,
  ...props
}: {
  status: PresenceStatus;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-caption1 font-medium",
        CHIP_CLASS[status],
        className,
      )}
      {...props}
    >
      <PresenceDot status={status} className="size-2" />
      {LABEL[status]}
    </span>
  );
}
