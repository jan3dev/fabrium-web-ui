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

/** ⌘K: type part of a room name, Enter to open it. */
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
          {rooms.map((room) => {
            const isDm = dmIds.has(room.roomId);
            return (
              <CommandItem
                key={room.roomId}
                value={`${room.name} ${room.roomId}`}
                onSelect={() => {
                  onOpenChange(false);
                  navigate(`/room/${room.roomId}`);
                }}
              >
                <RoomGlyph
                  kind={isDm ? "dm" : "stream"}
                  dmUserId={isDm ? room.guessDMUserId() : null}
                />
                <span className="truncate">{room.name || room.roomId}</span>
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
