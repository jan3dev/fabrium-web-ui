import { useEffect } from "react";
import { type Room, type MatrixEvent, NotificationCountType, RoomEvent } from "matrix-js-sdk";
import { MatrixClientPeg } from "../client/peg";

function lastLiveEvent(room: Room): MatrixEvent | null {
  const tl = room.getLiveTimeline();
  const events = tl.getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.getType() === "m.room.message") return ev;
  }
  return events[events.length - 1] ?? null;
}

/** Send a read receipt for the room's latest event. Failures are tolerated: the next visit retries. */
export function markRoomRead(room: Room): void {
  const ev = lastLiveEvent(room);
  if (!ev) return;
  void MatrixClientPeg.safeGet()
    ?.sendReadReceipt(ev)
    .catch(() => {});
}

/** Mark every unread room in `rooms` (default: all joined rooms) as read. */
export function markAllRead(rooms?: Room[]): void {
  const all = rooms ?? MatrixClientPeg.safeGet()?.getRooms() ?? [];
  for (const room of all) {
    if (room.getUnreadNotificationCount(NotificationCountType.Total) > 0) markRoomRead(room);
  }
}

export function useMarkRead(roomId: string): void {
  useEffect(() => {
    const client = MatrixClientPeg.safeGet();
    const room = client?.getRoom(roomId);
    if (!client || !room) return;

    let lastSent: string | null = null;
    const fire = () => {
      const ev = lastLiveEvent(room);
      if (!ev) return;
      const id = ev.getId() ?? null;
      if (id !== null && id === lastSent) return;
      lastSent = id;
      void client.sendReadReceipt(ev).catch(() => {
        // tolerated — a transient network failure shouldn't crash the room view
      });
    };

    fire();
    const onTimeline = () => fire();
    room.on(RoomEvent.Timeline, onTimeline);
    return () => {
      room.off(RoomEvent.Timeline, onTimeline);
    };
  }, [roomId]);
}
