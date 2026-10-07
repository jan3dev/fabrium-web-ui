// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/ChannelContextMenu.tsx. Modified.
import type * as React from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  BellIcon,
  CircleCheckIcon,
  LinkIcon,
  SignOutIcon,
  StarIcon,
} from "@/components/icons";
import {
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { MatrixClientPeg } from "../../../client/peg";
import { markRoomRead } from "../../../hooks/use-mark-read";
import { useRoomFavorite } from "../../../hooks/use-room-favorite";
import { useRoomNotifState } from "../../../hooks/use-room-notif-state";
import { useUnread } from "../../../hooks/use-unread";
import { buildRoomLink } from "../../../lib/matrix/permalinks";
import type { RoomNotifState } from "../../../lib/matrix/notification-prefs";

const NOTIF_LABELS: Record<RoomNotifState, string> = {
  all: "All messages",
  mentions: "Mentions only",
  mute: "Mute",
};

/**
 * A fixed-width leading slot for menu rows so labels stay left-aligned whether
 * or not a row has an icon.
 */
function IconSlot({ children }: { children?: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4"
    >
      {children}
    </span>
  );
}

/** Right-click menu for a sidebar room row. */
export function RoomContextMenuItems({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const current = useMatch("/room/:roomId")?.params.roomId === roomId;
  const { total } = useUnread(roomId);
  const { isFavorite, toggle: toggleFavorite } = useRoomFavorite(roomId);
  const { state: notifState, setState: setNotifState } =
    useRoomNotifState(roomId);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        buildRoomLink(window.location.origin, roomId),
      );
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const markRead = () => {
    const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
    if (room) markRoomRead(room);
  };

  const leave = async () => {
    await MatrixClientPeg.safeGet()?.leave(roomId);
    if (current) navigate("/");
  };

  return (
    <>
      <ContextMenuItem onSelect={() => void copyLink()}>
        <IconSlot>
          <LinkIcon />
        </IconSlot>
        Copy link
      </ContextMenuItem>
      {total > 0 ? (
        <ContextMenuItem onSelect={markRead}>
          <IconSlot>
            <CircleCheckIcon />
          </IconSlot>
          Mark as read
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void toggleFavorite()}>
        <IconSlot>
          <StarIcon
            className={
              isFavorite ? "fill-current text-accent-warning" : undefined
            }
          />
        </IconSlot>
        {isFavorite ? "Remove from favorites" : "Add to favorites"}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <IconSlot>
            <BellIcon />
          </IconSlot>
          Notifications
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={notifState}
            onValueChange={(value) =>
              void setNotifState(value as RoomNotifState)
            }
          >
            {(Object.keys(NOTIF_LABELS) as RoomNotifState[]).map((value) => (
              <ContextMenuRadioItem key={value} value={value}>
                {NOTIF_LABELS[value]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => void leave()}>
        <IconSlot>
          <SignOutIcon />
        </IconSlot>
        Leave room
      </ContextMenuItem>
    </>
  );
}
