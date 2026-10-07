// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/lib/timelineItems.ts, messageGrouping.ts, virtualizedTimelineItems.ts. Modified.
/**
 * Flattens timeline entries into the row stream the virtual list renders: day
 * dividers, the "New" divider, then one row per entry. Pure, so the prepend
 * and grouping rules are unit-tested.
 */
import type { TimelineEntry } from "@/model/types";

/**
 * Max gap between two same-author messages for the later one to render as a
 * continuation (no avatar, no header).
 */
export const MESSAGE_GROUPING_WINDOW_MS = 10 * 60 * 1000;

export type TimelineItem =
  // A timestamp, not a label, so "Today" resolves against the current clock.
  | { kind: "day-divider"; key: string; headingTimestamp: number }
  | { kind: "unread-divider"; key: string }
  | { kind: "leading"; key: string }
  | {
      kind: "entry";
      key: string;
      entry: TimelineEntry;
      isContinuation: boolean;
      isFollowedByContinuation: boolean;
    };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function continues(
  previous: TimelineEntry | null,
  current: TimelineEntry,
): boolean {
  if (!previous) return false;
  const a = previous.message;
  const b = current.message;
  // A message with a thread or a send state keeps its own header.
  if (a.kind !== "message" || b.kind !== "message") return false;
  if (a.pending || b.pending || a.failed || b.failed || previous.thread)
    return false;
  const gap = b.createdAt - a.createdAt;
  return (
    a.author.id === b.author.id && gap >= 0 && gap <= MESSAGE_GROUPING_WINDOW_MS
  );
}

/**
 * Day dividers sit only at proven boundaries: before a day that follows an
 * older loaded day, or before the first day once history is exhausted. The
 * oldest loaded day's start is just the edge of the loaded window; a divider
 * there would have older same-day rows prepend behind it and break the exact
 * key suffix that virtua's `shift` relies on.
 */
export function buildTimelineItems(
  entries: readonly TimelineEntry[],
  {
    firstUnreadId = null,
    historyExhausted = false,
    leading = false,
  }: {
    firstUnreadId?: string | null;
    historyExhausted?: boolean;
    leading?: boolean;
  } = {},
): TimelineItem[] {
  const items: TimelineItem[] = leading
    ? [{ kind: "leading", key: "leading" }]
    : [];
  let previous: TimelineEntry | null = null;
  let previousItem: Extract<TimelineItem, { kind: "entry" }> | null = null;
  let day: number | null = null;

  for (const entry of entries) {
    const { message } = entry;
    const entryDay = startOfDay(message.createdAt);
    if (entryDay !== day) {
      if (day !== null || historyExhausted) {
        items.push({
          kind: "day-divider",
          key: `day:${entryDay}`,
          headingTimestamp: message.createdAt,
        });
      }
      day = entryDay;
      previous = null;
    }
    if (message.id === firstUnreadId && items.length > 0) {
      items.push({ kind: "unread-divider", key: `unread:${message.id}` });
      previous = null;
    }
    const isContinuation = continues(previous, entry);
    if (isContinuation && previousItem)
      previousItem.isFollowedByContinuation = true;
    previousItem = {
      kind: "entry",
      key: message.id,
      entry,
      isContinuation,
      isFollowedByContinuation: false,
    };
    items.push(previousItem);
    previous = entry;
  }
  return items;
}

/** True when `keys` is `previousKeys` with rows added in front, and nothing else changed. */
export function didPrepend(
  previousKeys: readonly string[],
  keys: readonly string[],
): boolean {
  const added = keys.length - previousKeys.length;
  return added > 0 && previousKeys.every((key, i) => key === keys[i + added]);
}
