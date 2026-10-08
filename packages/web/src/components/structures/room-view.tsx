import { useAwaitingInput } from "../../hooks/use-timeline";
import { useOutletContext, useParams, useSearchParams } from "react-router-dom";
import type { LoggedInOutletContext } from "./logged-in-view";
import { Composer } from "../rooms/composer";
import { TypingIndicator } from "../rooms/typing-indicator";
import { NotJoinedRoom } from "./not-joined-room";
import { TimelinePanel } from "./timeline-panel";
import { useMarkRead } from "../../hooks/use-mark-read";
import { useTyping } from "../../hooks/use-typing";
import { useRoomKnown } from "../../hooks/use-room-known";

/** The room's main column: timeline and room composer. Threads open in the right pane. */
export function RoomView() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  // With a thread open, `?event=` points into the thread pane, not the timeline.
  const highlightEventId = searchParams.get("thread")
    ? undefined
    : (searchParams.get("event") ?? undefined);
  // Undefined outside the logged-in shell (tests, stories).
  const workforceSpaceId =
    useOutletContext<LoggedInOutletContext | undefined>()?.spaceId ?? null;
  const known = useRoomKnown(roomId ?? "");
  const awaitingUserIds = useAwaitingInput(roomId ?? "");
  const typingUserIds = useTyping(roomId ?? "");
  useMarkRead(roomId ?? "");

  function openThread(id: string) {
    // A new history entry, so Back closes the thread again.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("thread", id);
      next.delete("event");
      next.delete("pane");
      return next;
    });
  }

  if (!roomId) return <div>No room selected</div>;
  if (!known) {
    const qs = searchParams.toString();
    return <NotJoinedRoom roomId={roomId} search={qs ? `?${qs}` : ""} />;
  }
  return (
    <article className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <TimelinePanel
          key={roomId}
          roomId={roomId}
          workforceSpaceId={workforceSpaceId}
          highlightEventId={highlightEventId}
          onOpenThread={openThread}
        />
      </div>
      <TypingIndicator
        awaitingUserIds={awaitingUserIds}
        typingUserIds={typingUserIds}
        roomId={roomId}
      />
      <Composer roomId={roomId} workforceSpaceId={workforceSpaceId} />
    </article>
  );
}
