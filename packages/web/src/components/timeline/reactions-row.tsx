// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageReactions.tsx. Modified.
import { SmilePlusIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserName } from "@/hooks/use-user-name";
import { cn } from "@/lib/utils";
import type { TimelineReaction } from "@/model/types";
import { ReactionPicker } from "./reaction-picker";

const PILL =
  "inline-flex h-7 items-center rounded-pill border text-caption1 font-medium leading-none transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

function ReactorName({ userId, roomId }: { userId: string; roomId: string }) {
  return <>{useUserName(userId, roomId)}</>;
}

function Reactors({ reaction, roomId }: { reaction: TimelineReaction; roomId: string }) {
  const ids = reaction.actorIds;
  return (
    <span>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 ? (i === ids.length - 1 ? " and " : ", ") : null}
          <ReactorName userId={id} roomId={roomId} />
        </span>
      ))}{" "}
      reacted with {reaction.emoji}
    </span>
  );
}

/** Reaction pills under a message. Click toggles your own reaction. */
export function ReactionsRow({
  reactions,
  roomId,
  onToggle,
}: {
  reactions: TimelineReaction[];
  roomId: string;
  onToggle?: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="group/reactions mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="reactions-row">
      {reactions.map((reaction) => (
        <Tooltip key={reaction.emoji}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${reaction.emoji} ${reaction.count}`}
              aria-pressed={reaction.reactedByMe}
              disabled={!onToggle}
              onClick={() => onToggle?.(reaction.emoji)}
              className={cn(
                PILL,
                "min-w-12 justify-center gap-1.5 px-2",
                reaction.reactedByMe
                  ? "border-accent-brand/40 bg-accent-brand-transparent text-accent-brand"
                  : "border-surface-border-primary bg-surface-secondary text-text-primary hover:bg-surface-tertiary",
              )}
            >
              <span aria-hidden>{reaction.emoji}</span>
              <span className="tabular-nums text-text-secondary">{reaction.count}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <Reactors reaction={reaction} roomId={roomId} />
          </TooltipContent>
        </Tooltip>
      ))}
      {onToggle ? (
        <ReactionPicker
          onPick={onToggle}
          trigger={
            <button
              type="button"
              aria-label="add reaction"
              className={cn(
                PILL,
                "w-10 justify-center border-surface-border-primary bg-surface-secondary text-text-secondary hover:bg-surface-tertiary [&_svg]:size-4",
                "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 data-[state=open]:opacity-100",
              )}
            >
              <SmilePlusIcon />
            </button>
          }
        />
      ) : null}
    </div>
  );
}
