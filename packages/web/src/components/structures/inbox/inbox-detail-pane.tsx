// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/home/ui/InboxDetailPane.tsx. Modified.
import type * as React from "react";

import { ArrowLeftIcon, ExternalLinkIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { formatAbsoluteTime } from "@/lib/time";
import type { InboxItem } from "@/model/inbox";

const CONTEXT: Record<InboxItem["category"], string> = {
  needs_action: "Needs your answer",
  mention: "Mentioned you",
  activity: "Reply in a thread you follow",
};

/** The selected inbox item: where it is, a way there, and the item itself as `children`. */
export function InboxDetailPane({
  item,
  onBack,
  onOpen,
  children,
}: {
  item: InboxItem;
  /** Single-column layout only: back to the list. */
  onBack?: () => void;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Inbox item"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="inbox-detail"
    >
      <header className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        {onBack ? (
          <IconButton
            icon={<ArrowLeftIcon />}
            label="Back to inbox"
            onClick={onBack}
          />
        ) : null}
        <div className="min-w-0 flex-1 px-1">
          <h2 className="min-w-0">
            <button
              className="block max-w-full truncate rounded-utility text-left text-body2 font-semibold text-text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              data-testid="inbox-detail-room"
              onClick={onOpen}
              type="button"
            >
              #{item.roomName}
            </button>
          </h2>
          <p
            className="truncate text-caption1 text-text-tertiary"
            title={formatAbsoluteTime(item.message.createdAt)}
          >
            {CONTEXT[item.category]}
          </p>
        </div>
        <IconButton
          data-testid="inbox-open-in-room"
          icon={<ExternalLinkIcon />}
          label="Open in room"
          onClick={onOpen}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3">
        {children}
      </div>
    </section>
  );
}
