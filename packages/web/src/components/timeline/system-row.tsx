import { UserAvatar } from "@/components/user-avatar";
import type { TimelineMessage } from "@/model/types";

/**
 * Compact one-liners for membership changes, room state changes and session
 * breaks. `membership` bodies already name the people involved; `state`
 * bodies read after the author's name.
 */
export function SystemRow({ message }: { message: TimelineMessage }) {
  if (message.kind === "divider") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-caption2 font-medium uppercase text-text-tertiary">
        <div className="h-px flex-1 bg-surface-border-primary" />
        <span>{message.body}</span>
        <div className="h-px flex-1 bg-surface-border-primary" />
      </div>
    );
  }
  return (
    <div className="mx-1 flex items-center gap-2.5 px-2 py-1" data-testid="system-row">
      <div className="flex w-8 shrink-0 justify-end">
        <UserAvatar userId={message.author.id} size="xs" />
      </div>
      <p className="min-w-0 text-caption1 text-text-secondary">
        {message.kind === "state" ? (
          <>
            <span className="font-medium text-text-primary">{message.author.displayName}</span> {message.body}
          </>
        ) : (
          message.body
        )}
      </p>
    </div>
  );
}
