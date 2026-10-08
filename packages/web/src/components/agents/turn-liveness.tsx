// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/TurnLivenessIndicator.tsx. Modified.
import { cn } from "@/lib/utils";

const MARKS = [0, 250, 500];

/**
 * Three marks pulsing in turn while an agent turn runs. CSS only; the global
 * reduced-motion rule stills them.
 */
export function TurnLivenessIndicator({ className }: { className?: string }) {
  return (
    <span
      aria-label="Agent turn in progress"
      className={cn("inline-flex shrink-0 items-center gap-0.5 text-actor-agent", className)}
      data-testid="turn-liveness-indicator"
      role="status"
    >
      {MARKS.map((delay) => (
        <span
          className="size-1 animate-pulse rounded-full bg-current"
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
