// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/TimelineMessageList.tsx. Modified.
import * as React from "react";
import { VList, type VListHandle } from "virtua";

import { useBottomSettle } from "@/hooks/timeline/use-bottom-settle";
import { useNow } from "@/hooks/use-now";
import {
  buildTimelineItems,
  didPrepend,
  type TimelineItem,
} from "@/lib/timeline/timeline-items";
import { formatDayDivider } from "@/lib/time";
import type { TimelineEntry } from "@/model/types";
import { DayDivider } from "./day-divider";
import { UnreadDivider } from "./unread-divider";

/** Start paging older history this close to the top. */
const START_REACHED_PX = 400;
const AT_BOTTOM_PX = 32;

export interface TimelineListHandle {
  scrollToBottom: () => void;
  /** False when the message is not loaded. */
  scrollToMessage: (messageId: string) => boolean;
}

type EntryItem = Extract<TimelineItem, { kind: "entry" }>;

export function TimelineList({
  entries,
  historyExhausted,
  firstUnreadId = null,
  leading,
  renderEntry,
  onStartReached,
  onAtBottomChange,
  ref,
}: {
  entries: readonly TimelineEntry[];
  /** The loaded window provably starts at the beginning of the room. */
  historyExhausted: boolean;
  /** Renders a "New" divider above this message. */
  firstUnreadId?: string | null;
  /** First row once history is exhausted (the room intro). */
  leading?: React.ReactNode;
  renderEntry: (item: EntryItem) => React.ReactNode;
  onStartReached?: () => void;
  onAtBottomChange?: (atBottom: boolean) => void;
  ref?: React.Ref<TimelineListHandle>;
}) {
  const now = useNow();
  const listRef = React.useRef<VListHandle>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  // Presence, not identity: callers pass a fresh element each render.
  const hasLeading = historyExhausted && !!leading;
  const items = React.useMemo(
    () =>
      buildTimelineItems(entries, {
        firstUnreadId,
        historyExhausted,
        leading: hasLeading,
      }),
    [entries, firstUnreadId, historyExhausted, hasLeading],
  );
  const keys = React.useMemo(() => items.map((item) => item.key), [items]);
  const itemsLengthRef = React.useRef(items.length);
  itemsLengthRef.current = items.length;

  // Decided during render: virtua reads `shift` in the same commit as the new rows.
  const previousKeysRef = React.useRef<readonly string[]>([]);
  const isPrepend = didPrepend(previousKeysRef.current, keys);
  const atBottomRef = React.useRef(true);
  const { armed: bottomArmed, cancel: cancelBottomSettle, settle: settleAtBottom } =
    useBottomSettle(hostRef, listRef, itemsLengthRef);

  React.useLayoutEffect(() => {
    const previous = previousKeysRef.current;
    previousKeysRef.current = keys;
    if (keys.length === 0) return;
    // First paint, and rows arriving while the reader sits at the bottom. The
    // keys array is rebuilt on every change, so compare its tail, not its
    // identity. A reader who never scrolled away counts as at the bottom even
    // if a scroll event mid-measure briefly said otherwise.
    const appended = !isPrepend && previous.at(-1) !== keys.at(-1);
    if (previous.length === 0 || (appended && (atBottomRef.current || bottomArmed()))) settleAtBottom();
    // A window shorter than the viewport never scrolls, so ask for more here too.
    const scroller = hostRef.current?.firstElementChild;
    if (
      scroller &&
      scroller.scrollHeight - scroller.clientHeight <= START_REACHED_PX
    )
      onStartReached?.();
  }, [keys, isPrepend, settleAtBottom, bottomArmed, onStartReached]);

  React.useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: settleAtBottom,
      scrollToMessage(messageId) {
        const index = items.findIndex(
          (item) =>
            item.kind === "entry" && item.entry.message.id === messageId,
        );
        if (index < 0) return false;
        cancelBottomSettle();
        atBottomRef.current = false;
        listRef.current?.scrollToIndex(index, { align: "center" });
        return true;
      },
    }),
    [items, cancelBottomSettle, settleAtBottom],
  );

  const handleScroll = React.useCallback(
    (offset: number) => {
      const list = listRef.current;
      if (!list) return;
      const atBottom =
        list.scrollSize - list.viewportSize - offset <= AT_BOTTOM_PX;
      if (atBottom !== atBottomRef.current) {
        atBottomRef.current = atBottom;
        onAtBottomChange?.(atBottom);
      }
      if (offset <= START_REACHED_PX) onStartReached?.();
    },
    [onAtBottomChange, onStartReached],
  );

  return (
    <div className="relative h-full min-h-0 w-full" ref={hostRef}>
      <VList
        ref={listRef}
        className="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-3"
        data={items}
        // Measure well ahead of the reader: virtua hides a new row until its
        // first measurement, and a short lead shows as blank rows on fast scrolls.
        bufferSize={
          typeof window === "undefined" ? 1000 : window.innerHeight * 2
        }
        style={{ overflowAnchor: "none" }}
        shift={isPrepend}
        onScroll={handleScroll}
        data-testid="message-timeline"
      >
        {(item) => {
          switch (item.kind) {
            case "leading":
              return <div key={item.key}>{leading}</div>;
            case "day-divider":
              return (
                <DayDivider
                  key={item.key}
                  label={formatDayDivider(item.headingTimestamp, now)}
                />
              );
            case "unread-divider":
              return <UnreadDivider key={item.key} />;
            case "entry":
              return <div key={item.key}>{renderEntry(item)}</div>;
          }
        }}
      </VList>
    </div>
  );
}
