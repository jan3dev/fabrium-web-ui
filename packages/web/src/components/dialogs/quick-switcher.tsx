import type { Room } from "matrix-js-sdk";
import { useNavigate } from "react-router-dom";

import { RoomGlyph } from "@/components/room-glyph";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useDirectRooms } from "../../hooks/use-direct-rooms";
import { useRoomList } from "../../hooks/use-room-list";
import { useUnread } from "../../hooks/use-unread";
import { UnreadBadge } from "../structures/sidebar/unread-badge";

/** ⌘K: type part of a room name, Enter to open it. Rows show their unread count. */
export function QuickSwitcher({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const rooms = useRoomList().filter(
    (r) => !r.isSpaceRoom() && r.getMyMembership() === "join",
  );
  const dmIds = new Set(useDirectRooms().map((r) => r.roomId));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to a room"
      description="Search rooms by name"
    >
      <Command>
        <CommandInput placeholder="Jump to…" />
        <CommandList>
          <CommandEmpty>No rooms match.</CommandEmpty>
          {rooms.map((room) => (
            <SwitcherRow
              key={room.roomId}
              room={room}
              isDm={dmIds.has(room.roomId)}
              onSelect={() => {
                onOpenChange(false);
                navigate(`/room/${room.roomId}`);
              }}
            />
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function SwitcherRow({ room, isDm, onSelect }: { room: Room; isDm: boolean; onSelect: () => void }) {
  const { total, highlight } = useUnread(room.roomId);
  return (
    <CommandItem value={`${room.name} ${room.roomId}`} onSelect={onSelect}>
      <RoomGlyph
        kind={isDm ? "dm" : "stream"}
        dmUserId={isDm ? room.guessDMUserId() : null}
        isPrivate={room.getJoinRule() === "invite"}
      />
      <span className="flex-1 truncate">{room.name || room.roomId}</span>
      <UnreadBadge total={total} highlight={highlight} />
    </CommandItem>
  );
}
