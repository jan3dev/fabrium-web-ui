// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/chat/ui/ChatHeader.tsx. Modified.
import { useSyncExternalStore } from "react";
import { useMatch } from "react-router-dom";

import { BellOffIcon, InfoIcon, StarIcon } from "@/components/icons";
import { RoomGlyph } from "@/components/room-glyph";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { MatrixClientPeg } from "../../client/peg";
import { useDirectRooms } from "../../hooks/use-direct-rooms";
import { useJoinRule } from "../../hooks/use-join-rule";
import { useMemberRoles } from "../../hooks/use-member-roles";
import { useRoomFavorite } from "../../hooks/use-room-favorite";
import { useRoomNotifState } from "../../hooks/use-room-notif-state";
import { useRoomTopic } from "../../hooks/use-room-topic";
import { useWorkforce } from "../../hooks/use-workforce";
import { MemberStack } from "./member-stack";
import { RoomStatusBadge } from "./room-status-badge";

interface RoomHeaderProps {
  workforceSpaceId?: string | null;
  membersOpen?: boolean;
  infoOpen?: boolean;
  onToggleMembers?: () => void;
  onToggleInfo?: () => void;
}

/** Room title row: glyph, name (opens room info), status markers, members and actions. */
export function RoomHeader({
  workforceSpaceId,
  membersOpen,
  infoOpen,
  onToggleMembers,
  onToggleInfo,
}: RoomHeaderProps) {
  const roomId = useMatch("/room/:roomId")?.params.roomId ?? "";
  const client = useSyncExternalStore(
    (cb) => MatrixClientPeg.subscribe(cb),
    () => MatrixClientPeg.safeGet(),
    () => null,
  );
  const members = useMemberRoles(roomId);
  const topic = useRoomTopic(roomId);
  const { isFavorite, toggle: toggleFavorite } = useRoomFavorite(roomId);
  const { rule } = useJoinRule(roomId);
  const { state: notifState } = useRoomNotifState(roomId);
  const { isAgent } = useWorkforce(workforceSpaceId ?? "");
  const isDm = useDirectRooms().some((r) => r.roomId === roomId);

  const room = client?.getRoom(roomId);
  if (!roomId || !client) return null;

  const roomName = room?.name ?? roomId;
  const dmUserId = isDm ? (room?.guessDMUserId() ?? null) : null;
  const isAgentDm = !!dmUserId && isAgent(dmUserId);
  const archived = !!room?.currentState.getStateEvents("m.room.tombstone", "");
  const encrypted = !!room?.hasEncryptionStateEvent();

  return (
    <header
      className="relative z-30 flex h-12 min-w-0 shrink-0 cursor-default items-center gap-2.5 border-b border-border px-3 select-none md:px-4"
      data-testid="room-header"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <RoomGlyph
          kind={isDm ? "dm" : "stream"}
          isPrivate={rule === "invite"}
          dmUserId={dmUserId}
          isAgent={isAgentDm}
          className="text-text-tertiary"
        />
        <h1 className="min-w-0">
          <button
            type="button"
            className="block max-w-full cursor-pointer truncate rounded-utility px-1 font-heading text-subtitle font-semibold tracking-tight hover:bg-surface-secondary"
            onClick={onToggleInfo}
            title={topic ?? undefined}
          >
            {roomName}
          </button>
        </h1>
        {isAgentDm ? <Badge tone="agent">Agent</Badge> : null}
        <RoomStatusBadge archived={archived} encrypted={encrypted} />
        {notifState === "mute" ? (
          <span
            aria-label="Muted"
            role="img"
            className="flex size-5 items-center justify-center text-text-tertiary"
          >
            <BellOffIcon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {members.length > 0 ? (
          <MemberStack
            members={members}
            open={membersOpen}
            onToggle={onToggleMembers}
          />
        ) : null}
        <IconButton
          icon={
            <StarIcon
              className={cn(isFavorite && "fill-current text-accent-warning")}
            />
          }
          label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => void toggleFavorite()}
          size="small"
          tooltipSide="bottom"
        />
        <IconButton
          aria-pressed={infoOpen}
          icon={<InfoIcon />}
          label="Room details"
          onClick={onToggleInfo}
          size="small"
          tooltipSide="bottom"
        />
      </div>
    </header>
  );
}
