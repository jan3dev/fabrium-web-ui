import { ClientEvent, type Room, RoomEvent } from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";

const EMPTY: Room[] = [];

let cached: Room[] = EMPTY;
// A rename keeps the Room objects: the names are compared too, so the list changes with them.
let names: string[] = [];

function snapshot(): Room[] {
  const next = MatrixClientPeg.safeGet()?.getRooms() ?? EMPTY;
  if (
    cached.length === next.length &&
    cached.every((r, i) => r === next[i] && r.name === names[i])
  ) {
    return cached;
  }
  cached = next;
  names = next.map((r) => r.name);
  return next;
}

export function useRoomList(): Room[] {
  return useSyncExternalStore(
    (cb) => {
      const client = MatrixClientPeg.safeGet();
      if (!client) return MatrixClientPeg.subscribe(cb);
      const onChange = () => cb();
      client.on(ClientEvent.Room, onChange);
      client.on(ClientEvent.DeleteRoom, onChange);
      client.on(RoomEvent.Name, onChange);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        client.off(ClientEvent.Room, onChange);
        client.off(ClientEvent.DeleteRoom, onChange);
        client.off(RoomEvent.Name, onChange);
        unsubPeg();
      };
    },
    snapshot,
    () => EMPTY,
  );
}
