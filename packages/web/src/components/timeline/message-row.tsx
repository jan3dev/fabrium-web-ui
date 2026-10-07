// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageRow.tsx. Modified.
import * as React from "react";

import { UserAvatar } from "@/components/user-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePresence } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";
import type { ThreadSummary, TimelineMessage } from "@/model/types";
import {
  FormattedMessageBody,
  PlainMessageBody,
} from "./formatted-message-body";
import { MessageActionBar } from "./message-action-bar";
import { InlineEdit } from "./message-actions";
import {
  MessageAuthor,
  MessageHeaderRow,
  MessageMetaSegments,
} from "./message-header";
import { MediaMessage } from "./media-message";
import { MessageTimestamp } from "./message-timestamp";
import { QuoteCard } from "./quote-card";
import { ReactionsRow } from "./reactions-row";
import { ReadReceiptsRow } from "./read-receipts-row";
import { SendFailure, SendingIndicator } from "./send-state";
import { ThreadSummaryButton } from "./thread-summary-button";
import { TruncatedBody } from "./truncated-body";

/** What a row can do to its message. The timeline container binds these to Matrix. */
export interface MessageRowActions {
  toggleReaction: (message: TimelineMessage, emoji: string) => void;
  /** Absent inside a thread view. */
  openThread?: (message: TimelineMessage) => void;
  edit: (message: TimelineMessage, body: string) => Promise<void>;
  remove: (message: TimelineMessage) => void;
  share: (message: TimelineMessage) => void;
  copyLink: (message: TimelineMessage) => void;
  copyText: (message: TimelineMessage) => void;
  quote: (message: TimelineMessage) => void;
  retrySend: (message: TimelineMessage) => void;
  cancelSend: (message: TimelineMessage) => void;
  canEdit: (message: TimelineMessage) => boolean;
  canDelete: (message: TimelineMessage) => boolean;
}

function AuthorAvatar({ userId }: { userId: string }) {
  const { presence } = usePresence(userId);
  return <UserAvatar userId={userId} size="sm" presence={presence} />;
}

function MessageBody({
  message,
  roomId,
  truncate,
}: {
  message: TimelineMessage;
  roomId: string;
  truncate: boolean;
}) {
  if (message.redacted) {
    return (
      <p className="text-body2 text-text-tertiary italic">Message deleted</p>
    );
  }
  if (message.media) return <MediaMessage media={message.media} />;
  if (message.quote) {
    return (
      <>
        {message.body ? (
          <PlainMessageBody text={message.body} roomId={roomId} />
        ) : null}
        <QuoteCard quote={message.quote} currentRoomId={roomId} />
      </>
    );
  }
  const body = message.formattedBody ? (
    <FormattedMessageBody html={message.formattedBody} roomId={roomId} />
  ) : (
    <PlainMessageBody text={message.body} roomId={roomId} />
  );
  return truncate ? <TruncatedBody>{body}</TruncatedBody> : body;
}

/**
 * One message: avatar gutter, header (author, actor chip, time), body,
 * reactions, thread summary. A continuation row (same author within a few
 * minutes) drops avatar and header and shows its time in the gutter on hover.
 */
export function MessageRow({
  message,
  thread = null,
  roomId,
  actions,
  isContinuation = false,
  isFollowedByContinuation = false,
  highlighted = false,
  truncateBody = false,
}: {
  message: TimelineMessage;
  thread?: ThreadSummary | null;
  roomId: string;
  actions: MessageRowActions;
  isContinuation?: boolean;
  isFollowedByContinuation?: boolean;
  highlighted?: boolean;
  /** Clamp a long body with "See more" (thread root). */
  truncateBody?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const settled = !message.pending && !message.failed;
  const canAct = settled && !message.redacted;

  const statusNode = message.pending ? (
    <SendingIndicator />
  ) : message.edited && !message.redacted ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-caption2 text-text-tertiary">(edited)</span>
      </TooltipTrigger>
      <TooltipContent>This message has been edited</TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <article
      className={cn(
        "group/message relative mx-1 flex gap-2.5 rounded-card px-2 transition-colors",
        "outline-none hover:bg-surface-secondary focus-within:bg-surface-secondary",
        isContinuation ? "items-start py-0.5" : "items-start pt-2 pb-0.5",
        !isFollowedByContinuation && "mb-1.5",
        message.failed && "opacity-60",
        highlighted &&
          "bg-accent-brand-transparent hover:bg-accent-brand-transparent",
      )}
      data-message-id={message.id}
      data-highlighted={highlighted || undefined}
      data-testid="message-row"
      // Focusable so a tap on touch screens shows the action bar (focus-within).
      tabIndex={-1}
    >
      {isContinuation ? (
        <div aria-hidden className="flex w-8 shrink-0 justify-end pt-0.5">
          <MessageTimestamp
            compact
            createdAt={message.createdAt}
            className="opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
          />
        </div>
      ) : (
        <div className="flex w-8 shrink-0 pt-0.5">
          <AuthorAvatar userId={message.author.id} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {isContinuation ? null : (
          <MessageHeaderRow>
            <MessageAuthor author={message.author} />
            <MessageMetaSegments
              segments={[
                {
                  key: "time",
                  node: !settled ? null : (
                    <MessageTimestamp createdAt={message.createdAt} />
                  ),
                },
                { key: "status", node: statusNode },
              ]}
            />
          </MessageHeaderRow>
        )}
        <div data-testid="message-body">
          {editing ? (
            <InlineEdit
              initialValue={message.body}
              onSave={(body) =>
                void actions.edit(message, body).then(() => setEditing(false))
              }
              onCancel={() => setEditing(false)}
            />
          ) : (
            <MessageBody
              message={message}
              roomId={roomId}
              truncate={truncateBody}
            />
          )}
          {isContinuation && statusNode ? (
            <div className="mt-0.5">{statusNode}</div>
          ) : null}
          {message.failed ? (
            <SendFailure
              reason={message.failedReason ?? "Couldn't reach the server"}
              onRetry={() => actions.retrySend(message)}
              onDelete={() => actions.cancelSend(message)}
            />
          ) : null}
          <ReactionsRow
            reactions={message.reactions}
            roomId={roomId}
            onToggle={
              canAct
                ? (emoji) => actions.toggleReaction(message, emoji)
                : undefined
            }
          />
          {thread && actions.openThread ? (
            <ThreadSummaryButton
              thread={thread}
              onOpen={() => actions.openThread?.(message)}
            />
          ) : null}
          {settled ? (
            <ReadReceiptsRow roomId={roomId} eventId={message.id} />
          ) : null}
        </div>
      </div>
      {canAct && !editing ? (
        <div
          className={cn(
            "absolute right-2 z-10",
            isContinuation ? "-top-4" : "top-0 -translate-y-1/2",
          )}
        >
          <MessageActionBar
            onReact={(emoji) => actions.toggleReaction(message, emoji)}
            onReply={
              actions.openThread
                ? () => actions.openThread?.(message)
                : undefined
            }
            onCopyLink={() => actions.copyLink(message)}
            onCopyText={
              message.media ? undefined : () => actions.copyText(message)
            }
            onQuote={message.media ? undefined : () => actions.quote(message)}
            onShare={() => actions.share(message)}
            onEdit={
              actions.canEdit(message) && !message.media
                ? () => setEditing(true)
                : undefined
            }
            onDelete={
              actions.canDelete(message)
                ? () => actions.remove(message)
                : undefined
            }
          />
        </div>
      ) : null}
    </article>
  );
}
