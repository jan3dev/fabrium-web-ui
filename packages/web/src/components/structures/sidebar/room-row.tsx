// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/SidebarSection.tsx (ChannelMenuButton). Modified.
import { type Room } from "matrix-js-sdk";
import { Link, useMatch } from "react-router-dom";

import { BellOffIcon } from "@/components/icons";
import { RoomGlyph } from "@/components/room-glyph";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useJoinRule } from "../../../hooks/use-join-rule";
import { useRoomNotifState } from "../../../hooks/use-room-notif-state";
import { useUnread } from "../../../hooks/use-unread";
import { RoomContextMenuItems } from "./room-context-menu";
import { UnreadBadge } from "./unread-badge";

interface RoomRowProps {
  room: Room;
  /** The room is in `m.direct`: show the other member's avatar instead of `#`. */
  isDm?: boolean;
  isAgent?: (userId: string) => boolean;
}

export function RoomRow({ room, isDm = false, isAgent }: RoomRowProps) {
  const isActive = useMatch("/room/:roomId")?.params.roomId === room.roomId;
  const { total, highlight } = useUnread(room.roomId);
  const { state: notifState } = useRoomNotifState(room.roomId);
  const { rule } = useJoinRule(room.roomId);
  const isUnread = total > 0;
  const isMuted = notifState === "mute";
  const dmUserId = isDm ? room.guessDMUserId() : null;
  // Channels show unread as bold text; a count only for mentions. DMs always count.
  const showCount = highlight > 0 || (isDm && isUnread);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarMenuItem
          data-sidebar-room-id={room.roomId}
          data-unread={
            isUnread ? (highlight > 0 ? "highlight" : "true") : undefined
          }
        >
          <SidebarMenuButton
            asChild
            isActive={isActive}
            className={cn(
              "data-[active=true]:font-normal",
              isUnread &&
                "font-semibold text-sidebar-foreground data-[active=true]:font-semibold",
              !isActive && !isUnread && "text-sidebar-foreground/80",
              !isActive && isMuted && !isUnread && "opacity-50",
            )}
          >
            <Link to={`/room/${room.roomId}`}>
              <RoomGlyph
                kind={isDm ? "dm" : "stream"}
                isPrivate={rule === "invite"}
                dmUserId={dmUserId}
                isAgent={!!dmUserId && !!isAgent?.(dmUserId)}
              />
              <span className="min-w-0 flex-1 truncate">
                {room.name || room.roomId}
              </span>
              {isMuted ? (
                <BellOffIcon
                  aria-label="Muted"
                  role="img"
                  className="size-4 shrink-0 text-sidebar-foreground/40"
                />
              ) : null}
              {showCount ? (
                <UnreadBadge total={total} highlight={highlight} />
              ) : null}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <RoomContextMenuItems roomId={room.roomId} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
