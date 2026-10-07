// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/ui/UnreadPill.tsx. Modified.
import type { ReactNode } from "react";

import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

const UNREAD_PILL_COMPOSITION_CLASS =
  "pointer-events-auto inline-flex h-7 min-h-7 cursor-pointer items-center gap-1.5 rounded-pill border px-2 py-1 text-caption2 font-medium shadow-button [&_svg]:size-4 [&_svg]:shrink-0";
const DEFAULT_UNREAD_PILL_TREATMENT_CLASS =
  "border-surface-border-primary bg-surface-primary text-text-secondary hover:bg-surface-secondary hover:text-text-primary";
const PRIMARY_UNREAD_PILL_TREATMENT_CLASS =
  "border-transparent bg-button-primary-background text-button-primary-foreground hover:brightness-95";

/** A floating "more unread this way" pill: arrow, optional leading content, label. */
export function UnreadPill({
  accessibleLabel,
  className,
  direction,
  emphasis = "default",
  label,
  leading,
  onClick,
  testId,
}: {
  accessibleLabel?: string;
  className?: string;
  direction: "up" | "down";
  emphasis?: "default" | "primary";
  label: string;
  leading?: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  const Arrow = direction === "up" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      className={cn(
        UNREAD_PILL_COMPOSITION_CLASS,
        emphasis === "primary"
          ? PRIMARY_UNREAD_PILL_TREATMENT_CLASS
          : DEFAULT_UNREAD_PILL_TREATMENT_CLASS,
        className,
      )}
      data-testid={testId}
      onClick={onClick}
    >
      <Arrow aria-hidden />
      {leading}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
