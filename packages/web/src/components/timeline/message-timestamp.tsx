// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageTimestamp.tsx. Modified.
import { useNow } from "@/hooks/use-now";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The time beside a message author, and the clock that fades in over the
 * avatar gutter on continuation rows (`compact`: "9:05", nothing more fits).
 * The full date and time is in the tooltip.
 */
export function MessageTimestamp({
  className,
  createdAt,
  compact = false,
}: {
  className?: string;
  createdAt: number;
  compact?: boolean;
}) {
  const now = useNow();
  const label = compact
    ? clock.formatToParts(createdAt).filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim()
    : formatRelativeTime(createdAt, now);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={new Date(createdAt).toISOString()}
          className={cn(
            "shrink-0 cursor-default whitespace-nowrap text-caption2 tabular-nums text-text-tertiary",
            className,
          )}
          data-testid="message-timestamp"
        >
          {label}
        </time>
      </TooltipTrigger>
      <TooltipContent side="top">{formatAbsoluteTime(createdAt)}</TooltipContent>
    </Tooltip>
  );
}
