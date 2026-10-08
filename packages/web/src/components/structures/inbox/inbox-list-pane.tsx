// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/home/ui/InboxListPane.tsx. Modified.
import type * as React from "react";

import { ExternalLinkIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { UserAvatar } from "@/components/user-avatar";
import type { MentionsState } from "@/hooks/use-inbox";
import { useNow } from "@/hooks/use-now";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { InboxCategory, InboxItem } from "@/model/inbox";
import { InboxListSkeleton } from "./inbox-skeleton";

export type InboxFilter = "all" | InboxCategory;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs_action", label: "To do" },
  { value: "mention", label: "Mentions" },
  { value: "activity", label: "Threads" },
] as const satisfies readonly { value: InboxFilter; label: string }[];

const EMPTY_TITLES: Record<InboxFilter, string> = {
  all: "Nothing new",
  needs_action: "Nothing needs action",
  mention: "No mentions",
  activity: "No new thread replies",
};

function labelOf(item: InboxItem): string {
  if (item.category === "needs_action") {
    return item.message.kind === "approval"
      ? "Approval needed in"
      : "Question in";
  }
  return item.category === "mention" ? "Mentioned you in" : "New reply in";
}

function InboxRow({
  item,
  now,
  selected,
  onSelect,
  onOpen,
}: {
  item: InboxItem;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const action = item.category === "needs_action";
  return (
    <li
      aria-current={selected ? "true" : undefined}
      className="group/inbox-item relative"
      data-testid={`inbox-item-${item.id}`}
    >
      <button
        aria-label={`Open inbox item from ${item.message.author.displayName}`}
        className={cn(
          "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-secondary focus-visible:bg-surface-secondary focus-visible:outline-hidden",
          selected && "bg-surface-selected hover:bg-surface-selected",
        )}
        onClick={onSelect}
        type="button"
      >
        <UserAvatar userId={item.message.author.id} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 truncate text-body2 font-semibold text-text-primary">
              {item.message.author.displayName}
            </span>
            <span
              className="flex shrink-0 items-center gap-1.5 text-caption1 text-text-tertiary transition-opacity group-hover/inbox-item:opacity-0 group-focus-within/inbox-item:opacity-0"
              title={formatAbsoluteTime(item.message.createdAt)}
            >
              {item.unread ? (
                <span
                  aria-label="Unread"
                  className="size-1.5 rounded-full bg-accent-brand"
                />
              ) : null}
              {formatRelativeTime(item.message.createdAt, now)}
            </span>
          </span>
          <span
            className={cn(
              "mt-0.5 flex min-w-0 items-center gap-1 text-caption2",
              action ? "font-medium text-accent-warning" : "text-text-tertiary",
            )}
          >
            <span className="shrink-0">{labelOf(item)}</span>
            <span className="truncate rounded-pill bg-surface-secondary px-1.5 text-text-secondary">
              #{item.roomName}
            </span>
          </span>
          <span
            className={cn(
              "mt-1 line-clamp-2 text-body2",
              item.unread ? "text-text-primary" : "text-text-secondary",
            )}
          >
            {item.preview}
          </span>
        </span>
      </button>
      <IconButton
        className="absolute top-2 right-3 opacity-0 transition-opacity group-hover/inbox-item:opacity-100 group-focus-within/inbox-item:opacity-100"
        icon={<ExternalLinkIcon />}
        label="Open in room"
        onClick={onOpen}
        size="small"
      />
    </li>
  );
}

export interface InboxListPaneProps {
  items: InboxItem[];
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  selectedId: string | null;
  onSelect: (item: InboxItem) => void;
  onOpen: (item: InboxItem) => void;
  mentions: MentionsState;
  hasMoreMentions: boolean;
  onLoadMoreMentions: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/** The inbox list: a filter, then one row per item, newest first. */
export function InboxListPane({
  items,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onOpen,
  mentions,
  hasMoreMentions,
  onLoadMoreMentions,
  className,
  style,
}: InboxListPaneProps) {
  const now = useNow();
  const visible =
    filter === "all" ? items : items.filter((i) => i.category === filter);
  const showsMentions = filter === "all" || filter === "mention";

  return (
    <section
      aria-label="Inbox"
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
      style={style}
    >
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-2">
        <h1 className="font-heading text-subtitle font-semibold">Inbox</h1>
        <SegmentedControl
          className="w-full"
          legend="Show"
          onValueChange={onFilterChange}
          optionTestIdPrefix="inbox-filter"
          options={FILTERS}
          testId="inbox-filter"
          value={filter}
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        data-testid="inbox-list"
      >
        {showsMentions && mentions === "unsupported" ? (
          <p className="mx-4 mb-2 rounded-utility bg-surface-secondary px-3 py-2 text-caption1 text-text-secondary">
            This server does not support the mentions list.
          </p>
        ) : null}
        {showsMentions && mentions === "error" ? (
          <p className="mx-4 mb-2 rounded-utility bg-accent-danger-transparent px-3 py-2 text-caption1 text-accent-danger">
            Couldn’t load mentions.
          </p>
        ) : null}
        {visible.length > 0 ? (
          <ul>
            {visible.map((item) => (
              <InboxRow
                item={item}
                key={item.id}
                now={now}
                onOpen={() => onOpen(item)}
                onSelect={() => onSelect(item)}
                selected={item.id === selectedId}
              />
            ))}
          </ul>
        ) : showsMentions && mentions === "loading" ? (
          <InboxListSkeleton />
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center px-6 text-center">
            <div>
              <p className="text-body2 font-medium text-text-primary">
                {EMPTY_TITLES[filter]}
              </p>
              <p className="mt-1 text-body2 text-text-secondary">
                {filter === "all"
                  ? "Approvals, questions, mentions and thread replies show up here."
                  : "Switch back to All to see other items."}
              </p>
            </div>
          </div>
        )}
        {showsMentions && hasMoreMentions ? (
          <div className="p-3">
            <Button
              className="w-full"
              onClick={onLoadMoreMentions}
              size="sm"
              variant="outline"
            >
              Load older mentions
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
