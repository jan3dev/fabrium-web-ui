import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectRooms } from "../../hooks/use-direct-rooms";
import { useFillGap } from "../../hooks/use-fill-gap";
import { useJoinRule } from "../../hooks/use-join-rule";
import { useLoadMoreHistory } from "../../hooks/use-load-more-history";
import { MatrixClientPeg } from "../../client/peg";
import { useRoomTopic } from "../../hooks/use-room-topic";
import { useTimelineEntries } from "../../hooks/use-timeline-entries";
import type { ThreadSummary, TimelineEntry } from "../../model/types";
import { RoomGlyph } from "../room-glyph";
import { RoomIntro } from "../timeline/room-intro";
import {
  TimelineList,
  type TimelineListHandle,
} from "../timeline/timeline-list";
import { TimelineRow } from "../timeline/timeline-row";
import { TimelineSkeleton } from "../timeline/timeline-skeleton";
import { useMessageActions } from "../timeline/use-message-actions";
import { UnreadPill } from "../ui/unread-pill";

const HIGHLIGHT_MS = 2500;
/** Pages to walk back looking for a `?event=` target before giving up. */
const MAX_HIGHLIGHT_PAGES = 10;

/**
 * The oldest message from someone else after my read receipt, among messages
 * that existed when the room opened. Null while the receipt's event is not loaded.
 */
function firstUnreadAfter(
  entries: readonly TimelineEntry[],
  readUpTo: string | null,
  me: string,
  openedAt: number,
): string | null {
  if (!readUpTo) return null;
  const index = entries.findIndex((e) => e.message.id === readUpTo);
  if (index < 0) return null;
  return (
    entries
      .slice(index + 1)
      .find((e) => e.message.kind === "message" && e.message.author.id !== me && e.message.createdAt <= openedAt)
      ?.message.id ?? null
  );
}

function RoomIntroFor({ roomId }: { roomId: string }) {
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
  const topic = useRoomTopic(roomId);
  const { rule } = useJoinRule(roomId);
  const isDm = useDirectRooms().some((r) => r.roomId === roomId);
  const dmUserId = isDm ? (room?.guessDMUserId() ?? null) : null;
  return (
    <RoomIntro
      name={room?.name ?? roomId}
      topic={topic}
      isDm={isDm}
      glyph={
        <RoomGlyph
          kind={isDm ? "dm" : "stream"}
          dmUserId={dmUserId}
          isPrivate={rule === "invite"}
        />
      }
    />
  );
}

export function TimelinePanel({
  roomId,
  workforceSpaceId = null,
  highlightEventId,
  onOpenThread,
}: {
  roomId: string;
  workforceSpaceId?: string | null;
  /** A message to scroll to and flash, from a `?event=` link. */
  highlightEventId?: string;
  onOpenThread?: (eventId: string) => void;
}) {
  const client = MatrixClientPeg.safeGet();
  const me = client?.getUserId() ?? "";
  const { entries, pendingRootIds } = useTimelineEntries(
    roomId,
    workforceSpaceId,
  );
  const { loadMore, loading, hasMore } = useLoadMoreHistory(roomId);
  const { fillGap, pendingGapId } = useFillGap(roomId);
  const listRef = useRef<TimelineListHandle>(null);
  const threads = useMemo(
    () =>
      new Map(
        entries.flatMap((e): [string, ThreadSummary][] =>
          e.thread ? [[e.message.id, e.thread]] : [],
        ),
      ),
    [entries],
  );
  const { actions, dialogs } = useMessageActions(roomId, {
    onOpenThread,
    threads,
  });

  // Read before useMarkRead moves the receipt to the bottom.
  const [{ readUpTo, openedAt }] = useState(() => ({
    readUpTo: client?.getRoom(roomId)?.getEventReadUpTo(me) ?? null,
    openedAt: Date.now(),
  }));
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  useEffect(() => {
    if (!firstUnreadId) setFirstUnreadId(firstUnreadAfter(entries, readUpTo, me, openedAt));
  }, [entries, readUpTo, me, openedAt, firstUnreadId]);

  // One-shot prefetch on room open, so a room with a short sync window settles
  // at the start of its history. Not marked done while hasMore is false: the
  // token may not have arrived yet.
  const prefetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefetchedRef.current === roomId || !hasMore) return;
    prefetchedRef.current = roomId;
    void loadMore();
  }, [roomId, hasMore, loadMore]);

  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightRef = useRef<{ id: string | null; pages: number }>({
    id: null,
    pages: 0,
  });
  useEffect(() => {
    if (!highlightEventId) return;
    const state = highlightRef.current;
    if (state.id !== highlightEventId)
      highlightRef.current = { id: highlightEventId, pages: 0 };
    else if (state.pages < 0) return; // already shown
    if (listRef.current?.scrollToMessage(highlightEventId)) {
      highlightRef.current.pages = -1;
      setHighlighted(highlightEventId);
      return;
    }
    // Not loaded yet: walk back a bounded number of pages.
    if (
      hasMore &&
      !loading &&
      highlightRef.current.pages < MAX_HIGHLIGHT_PAGES
    ) {
      highlightRef.current.pages += 1;
      void loadMore();
    }
  }, [highlightEventId, entries, hasMore, loading, loadMore]);
  useEffect(() => {
    if (!highlighted) return;
    const t = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlighted]);

  // "N new messages" while the reader is scrolled up. Counted by time, so
  // older history paging in above does not count as new.
  const [awaySince, setAwaySince] = useState<number | null>(null);
  const newest = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].message.kind === "message") return entries[i].message.createdAt;
    }
    return 0;
  }, [entries]);
  const onAtBottomChange = useCallback(
    (atBottom: boolean) => setAwaySince(atBottom ? null : newest),
    [newest],
  );
  const unseen = useMemo(
    () =>
      awaySince === null
        ? 0
        : entries.filter((e) => e.message.kind === "message" && e.message.createdAt > awaySince).length,
    [entries, awaySince],
  );

  const onStartReached = useCallback(() => {
    if (hasMore && !loading) void loadMore();
  }, [hasMore, loading, loadMore]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col justify-end overflow-y-auto">
        {hasMore || pendingRootIds.length > 0 ? (
          <TimelineSkeleton />
        ) : (
          <RoomIntroFor roomId={roomId} />
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <TimelineList
        ref={listRef}
        entries={entries}
        historyExhausted={!hasMore}
        firstUnreadId={firstUnreadId}
        leading={<RoomIntroFor roomId={roomId} />}
        onStartReached={onStartReached}
        onAtBottomChange={onAtBottomChange}
        renderEntry={(item) => (
          <TimelineRow
            entry={item.entry}
            roomId={roomId}
            actions={actions}
            isContinuation={item.isContinuation}
            isFollowedByContinuation={item.isFollowedByContinuation}
            highlighted={highlighted === item.entry.message.id}
            fillingGapId={pendingGapId}
            onFillGap={fillGap}
          />
        )}
      />
      {unseen > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <UnreadPill
            direction="down"
            emphasis="primary"
            label={`${unseen} new ${unseen === 1 ? "message" : "messages"}`}
            onClick={() => listRef.current?.scrollToBottom()}
          />
        </div>
      ) : null}
      {dialogs}
    </div>
  );
}
