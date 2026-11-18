import { ClientEvent, RoomEvent } from "matrix-js-sdk";
import { useCallback, useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";

function snapshot(roomId: string | null): string | null {
  if (!roomId) return null;
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
  return room?.name ?? null;
}

/** A room's name, followed live: `room.name` read in a render does not update on a rename. */
export function useRoomName(roomId: string | null): string | null {
  // Stable per room, so a re-render does not unsubscribe and subscribe again.
  const subscribe = useCallback(
    (cb: () => void) => {
      const client = MatrixClientPeg.safeGet();
      if (!client || !roomId) return MatrixClientPeg.subscribe(cb);

      let nameOff: (() => void) | null = null;
      const attach = () => {
        if (nameOff) return;
        const room = client.getRoom(roomId);
        if (!room) return;
        const onName = () => cb();
        room.on(RoomEvent.Name, onName);
        nameOff = () => room.off(RoomEvent.Name, onName);
      };
      attach();

      const onRoom = () => {
        attach();
        cb();
      };
      client.on(ClientEvent.Room, onRoom);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        client.off(ClientEvent.Room, onRoom);
        if (nameOff) nameOff();
        unsubPeg();
      };
    },
    [roomId],
  );
  return useSyncExternalStore(subscribe, () => snapshot(roomId), () => null);
}

