// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/TypingIndicatorRow.tsx. Modified.
import { Fragment, type ReactNode } from "react";

import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useUserName } from "../../hooks/use-user-name";

interface Props {
  typingUserIds: string[];
  /** Agents blocked on a question to a human. They show as waiting, not typing. */
  awaitingUserIds?: string[];
  roomId?: string;
  className?: string;
}

function Name({ userId, roomId }: { userId: string; roomId?: string }) {
  return <span className="font-semibold">{useUserName(userId, roomId)}</span>;
}

/** "A", "A and B", "A, B, and C", "A, B, and 2 others". */
function nameList(userIds: string[], roomId?: string): ReactNode {
  const names = userIds.map((id) => (
    <Name key={id} userId={id} roomId={roomId} />
  ));
  if (names.length === 1) return names[0];
  if (names.length === 2)
    return (
      <>
        {names[0]} and {names[1]}
      </>
    );
  if (names.length === 3)
    return (
      <>
        {names[0]}, {names[1]}, and {names[2]}
      </>
    );
  return (
    <>
      {names[0]}, {names[1]}, and {names.length - 2} others
    </>
  );
}

function Avatars({ userIds }: { userIds: string[] }) {
  return (
    <span className="flex shrink-0 items-center">
      {userIds.slice(0, 3).map((id, i) => (
        <UserAvatar
          key={id}
          userId={id}
          size="xs"
          className={cn("ring-1 ring-surface-background", i > 0 && "-ml-1.5")}
        />
      ))}
    </span>
  );
}

/**
 * Who is typing, and which agents wait for an answer, above the composer.
 * Keeps its one-line height when empty so the composer does not jump.
 */
export function TypingIndicator({
  typingUserIds: allTyping,
  awaitingUserIds = [],
  roomId,
  className,
}: Props) {
  const typing = allTyping.filter((id) => !awaitingUserIds.includes(id));
  const parts: ReactNode[] = [];
  if (awaitingUserIds.length > 0) {
    parts.push(
      <span key="awaiting" className="text-accent-warning">
        {nameList(awaitingUserIds, roomId)}{" "}
        {awaitingUserIds.length === 1 ? "is" : "are"} waiting for your input
      </span>,
    );
  }
  if (typing.length > 0) {
    parts.push(
      <span key="typing">
        {nameList(typing, roomId)} {typing.length === 1 ? "is" : "are"} typing…
      </span>,
    );
  }

  return (
    <div
      aria-live="polite"
      className={cn(
        "flex h-6 min-w-0 items-center gap-1.5 px-4 text-caption1 text-text-secondary",
        className,
      )}
      data-testid={parts.length > 0 ? "message-typing-indicator" : undefined}
    >
      {parts.length > 0 ? (
        <>
          <Avatars userIds={[...awaitingUserIds, ...typing]} />
          <p className="min-w-0 truncate">
            {parts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 ? " · " : null}
                {part}
              </Fragment>
            ))}
          </p>
        </>
      ) : null}
    </div>
  );
}
