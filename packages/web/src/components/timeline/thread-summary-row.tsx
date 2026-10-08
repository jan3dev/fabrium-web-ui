// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageThreadSummaryRow.tsx. Modified.
import { UserAvatar } from "@/components/user-avatar";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/time";
import type { ThreadSummary } from "@/model/types";

/**
 * "3 replies · last reply 5m ago" under a thread root, with the latest
 * repliers' faces. On hover the time gives way to "View thread".
 */
export function ThreadSummaryRow({
  thread,
  onOpen,
}: {
  thread: ThreadSummary;
  onOpen: () => void;
}) {
  const now = useNow();
  const replies = `${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"}`;
  const lastReply = thread.lastReplyAt
    ? formatRelativeTime(thread.lastReplyAt, now)
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={
        lastReply
          ? `View thread with ${replies}, last reply ${lastReply}`
          : `View thread with ${replies}`
      }
      data-testid="message-thread-summary"
      className={cn(
        "group/thread relative mt-1 -ml-1 inline-flex h-[1.875rem] w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-pill py-0 pr-3 pl-1 text-left text-caption1 font-medium text-text-secondary",
        "transition-colors hover:bg-surface-primary hover:text-text-primary hover:ring-1 hover:ring-border",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <span className="flex shrink-0 items-center">
        {thread.participants.map((p, i) => (
          <UserAvatar
            key={p.id}
            userId={p.id}
            size="xs"
            className={cn(
              "!size-6 ring-2 ring-surface-background",
              i > 0 && "-ml-1",
            )}
          />
        ))}
      </span>
      <span className="min-w-0 truncate">
        <span className="font-semibold text-accent-brand">{replies}</span>
        {lastReply ? (
          <>
            <span className="mx-1 font-normal text-text-tertiary">·</span>
            <span className="inline-grid font-normal text-text-tertiary">
              <span className="col-start-1 row-start-1 transition-opacity group-hover/thread:opacity-0 group-focus-visible/thread:opacity-0">
                last reply {lastReply}
              </span>
              <span className="col-start-1 row-start-1 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-visible/thread:opacity-100">
                View thread
              </span>
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}
