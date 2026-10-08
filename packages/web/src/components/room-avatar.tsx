import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { RoomStateEvent } from "matrix-js-sdk";
import { createAvatar } from "@dicebear/core";
import { shapes } from "@dicebear/collection";
import { Avatar } from "@/components/ui/avatar";
import { MatrixClientPeg } from "@/client/peg";
import { subscribeRoomState } from "@/hooks/matrix-subscriptions";
import { useAuthedMediaUrl } from "@/lib/matrix/authed-media";
import { cn } from "@/lib/utils";

/** The room's `mxc://` avatar, or null if it has none. */
export function useRoomAvatarMxc(roomId: string): string | null {
  return useSyncExternalStore(
    (cb) => {
      // m.room.avatar is a state event. subscribeRoomState also attaches once a
      // room that has not synced yet arrives.
      const unsubState = subscribeRoomState(roomId, [RoomStateEvent.Events], cb);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        unsubState();
        unsubPeg();
      };
    },
    () => MatrixClientPeg.safeGet()?.getRoom(roomId)?.getMxcAvatarUrl() || null,
    () => null,
  );
}

export function RoomAvatar({
  roomId,
  name,
  size = "default",
  className,
}: {
  roomId: string;
  name: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const mxc = useRoomAvatarMxc(roomId);
  const mxcSrc = useAuthedMediaUrl(mxc, { width: 64, height: 64, method: "crop" });
  const fallbackSrc = useMemo(
    () => createAvatar(shapes, { seed: roomId }).toDataUri(),
    [roomId],
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [mxcSrc]);
  const src = !failed && mxcSrc ? mxcSrc : fallbackSrc;
  return (
    <Avatar size={size} className={cn("rounded-md", className)}>
      <img
        src={src}
        alt={name}
        onError={() => {
          if (!failed && mxcSrc) setFailed(true);
        }}
        className="aspect-square size-full rounded-md object-cover"
      />
    </Avatar>
  );
}
