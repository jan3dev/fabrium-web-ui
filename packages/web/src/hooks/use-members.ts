import { type Room, type RoomMember, RoomStateEvent } from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";
import { subscribeRoomState } from "./matrix-subscriptions";

const EMPTY: RoomMember[] = [];
const cache = new WeakMap<Room, RoomMember[]>();

function snapshot(roomId: string): RoomMember[] {
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
  if (!room) return EMPTY;
  const next = room.getJoinedMembers();
  const cached = cache.get(room);
  if (
    cached &&
    cached.length === next.length &&
    cached.every((m, i) => m === next[i])
  ) {
    return cached;
  }
  cache.set(room, next);
  return next;
}

export function useMembers(roomId: string): RoomMember[] {
  return useSyncExternalStore(
    (cb) => {
      const unsubState = subscribeRoomState(roomId, [RoomStateEvent.Members], cb);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        unsubState();
        unsubPeg();
      };
    },
    () => snapshot(roomId),
    () => EMPTY,
  );
}
