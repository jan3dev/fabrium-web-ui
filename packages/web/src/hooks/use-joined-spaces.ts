import type { Room } from "matrix-js-sdk";
import { useMemo } from "react";
import { useRoomList } from "./use-room-list";

/** The joined rooms that are spaces; follows `useRoomList` (joins, leaves, renames). */
export function useJoinedSpaces(): Room[] {
  const rooms = useRoomList();
  return useMemo(() => rooms.filter((r) => r.isSpaceRoom()), [rooms]);
}
