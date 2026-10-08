import { type RoomMember, RoomStateEvent } from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";
import { subscribeRoomState } from "./matrix-subscriptions";

const EMPTY: RoomMember[] = [];
const cache = new Map<string, RoomMember[]>();

function snapshot(spaceId: string | null): RoomMember[] {
  if (!spaceId) return EMPTY;
  const room = MatrixClientPeg.safeGet()?.getRoom(spaceId);
  if (!room) return EMPTY;
  const cached = cache.get(spaceId) ?? EMPTY;
  const next = room.getJoinedMembers();
  if (cached.length === next.length && cached.every((m, i) => m === next[i])) {
    return cached;
  }
  cache.set(spaceId, next);
  return next;
}

export function useSpaceMembers(spaceId: string | null): RoomMember[] {
  return useSyncExternalStore(
    (cb) => {
      if (!spaceId) return MatrixClientPeg.subscribe(cb);
      const unsubState = subscribeRoomState(spaceId, [RoomStateEvent.Members], cb);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        unsubState();
        unsubPeg();
      };
    },
    () => snapshot(spaceId),
    () => EMPTY,
  );
}
