// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/UnreadDivider.tsx. Modified.

/** "New" rule above the oldest message that was unread when the room opened. */
export function UnreadDivider() {
  return (
    <section
      aria-label="New messages"
      className="flex items-center py-1"
      data-testid="message-unread-divider"
    >
      <div className="h-px flex-1 bg-accent-danger/40" />
      <span className="shrink-0 px-2 text-caption2 font-semibold uppercase text-accent-danger">New</span>
      <div className="h-px flex-1 bg-accent-danger/40" />
    </section>
  );
}
