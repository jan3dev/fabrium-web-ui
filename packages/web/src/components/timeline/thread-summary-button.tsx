import { UserAvatar } from "@/components/user-avatar";
import { useNow } from "@/hooks/use-now";
import { formatRelativeTime } from "@/lib/time";
import type { ThreadSummary } from "@/model/types";

/** "3 replies · 5m ago" under a thread root, with the latest repliers' faces. */
export function ThreadSummaryButton({ thread, onOpen }: { thread: ThreadSummary; onOpen: () => void }) {
  const now = useNow();
  const replies = `${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View thread (${replies})`}
      className="group/thread mt-1 -ml-1 flex items-center gap-2 rounded-utility px-1 py-0.5 text-caption1 hover:bg-surface-primary"
    >
      <span className="flex -space-x-1">
        {thread.participants.map((p) => (
          <UserAvatar key={p.id} userId={p.id} size="xs" className="ring-2 ring-surface-background" />
        ))}
      </span>
      <span className="font-semibold text-accent-brand group-hover/thread:underline">{replies}</span>
      {thread.lastReplyAt ? (
        <span className="text-text-tertiary">Last reply {formatRelativeTime(thread.lastReplyAt, now)}</span>
      ) : null}
    </button>
  );
}
