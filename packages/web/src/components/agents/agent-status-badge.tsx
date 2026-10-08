// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/AgentStatusBadge.tsx. Modified.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** "Working" while the agent has an open turn, else "Idle". */
export function AgentStatusBadge({
  working,
  className,
}: {
  working: boolean;
  className?: string;
}) {
  return (
    <Badge
      tone={working ? "agent" : "neutral"}
      className={cn(working && "motion-safe:animate-pulse", className)}
    >
      {working ? "Working" : "Idle"}
    </Badge>
  );
}
