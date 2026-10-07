// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/channels/ui/ChannelGlyph.tsx. Modified.
import { HashIcon, LockIcon } from "@/components/icons";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export type RoomGlyphKind = "stream" | "dm";

/** `#` for a channel, a lock when it is invite-only, the other person's avatar for a DM. */
export function RoomGlyph({
  kind,
  isPrivate = false,
  dmUserId,
  isAgent = false,
  className,
}: {
  kind: RoomGlyphKind;
  isPrivate?: boolean;
  /** The other member of a DM. */
  dmUserId?: string | null;
  isAgent?: boolean;
  className?: string;
}) {
  if (kind === "dm" && dmUserId) {
    return (
      <span className={cn("relative flex size-5 shrink-0", className)}>
        <UserAvatar userId={dmUserId} size="sm" className="size-5!" />
        {isAgent ? (
          <span
            role="img"
            aria-label="Agent"
            className="absolute -right-0.5 -bottom-0.5 size-2 rounded-xs bg-actor-agent ring-2 ring-sidebar"
          />
        ) : null}
      </span>
    );
  }
  const iconClass = cn("size-4 shrink-0", className);
  if (isPrivate) {
    return <LockIcon className={iconClass} aria-label="Private" role="img" />;
  }
  return <HashIcon className={iconClass} aria-hidden />;
}
