import { ClientEvent, type Room, RoomStateEvent } from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";
import { subscribeRoomState } from "./matrix-subscriptions";

const EMPTY: Room[] = [];

const cache = new Map<string, Room[]>();

function snapshot(spaceId: string): Room[] {
  const client = MatrixClientPeg.safeGet();
  const space = client?.getRoom(spaceId);
  const cached = cache.get(spaceId) ?? EMPTY;
  if (!client || !space) {
    if (cached !== EMPTY) cache.set(spaceId, EMPTY);
    return EMPTY;
  }
  const childIds = space.currentState
    .getStateEvents("m.space.child")
    .map((e) => e.getStateKey())
    .filter((k): k is string => !!k);
  const next = childIds.map((id) => client.getRoom(id)).filter((r): r is Room => !!r);
  if (cached.length === next.length && cached.every((r, i) => r === next[i])) {
    return cached;
  }
  cache.set(spaceId, next);
  return next;
}

export function useSpaceChildren(spaceId: string): Room[] {
  return useSyncExternalStore(
    (cb) => {
      const client = MatrixClientPeg.safeGet();
      if (!client) return MatrixClientPeg.subscribe(cb);

      // The space may not be in the client yet (sync delivers the workforce
      // space after the alias join); subscribeRoomState attaches once it
      // arrives. The Room listener also catches child rooms syncing in.
      const stateOff = subscribeRoomState(spaceId, [RoomStateEvent.Events], cb);
      client.on(ClientEvent.Room, cb);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        client.off(ClientEvent.Room, cb);
        stateOff();
        unsubPeg();
      };
    },
    () => snapshot(spaceId),
    () => EMPTY,
  );
}
