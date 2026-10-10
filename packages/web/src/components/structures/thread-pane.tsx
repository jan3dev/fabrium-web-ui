// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageThreadPanel.tsx. Modified.
import * as React from "react";

import { ArrowDownIcon } from "@/components/icons";
import { AuxPanelHeader } from "@/components/layout/aux-panel-header";
import { AuxPanel } from "@/components/layout/aux-panel-shell";
import { Button } from "@/components/ui/button";
import { useAwaitingInput } from "@/hooks/use-timeline";
import { buildTimelineItems } from "@/lib/timeline/timeline-items";
import { MatrixClientPeg } from "../../client/peg";
import { useAuxPanelWidth } from "../../hooks/use-aux-panel-width";
import { useLoadMoreThread } from "../../hooks/use-load-more-thread";
import { usePlan } from "../../hooks/use-plan";
import { useThreadEntries } from "../../hooks/use-timeline-entries";
import { useTyping } from "../../hooks/use-typing";
import { AgentActivityBar } from "../rooms/agent-activity-bar";
import { Composer } from "../rooms/composer";
import { TypingIndicator } from "../rooms/typing-indicator";
import { LoadMoreButton } from "../timeline/load-more-button";
import { PlanBoard } from "../timeline/plan-board";
import { TimelineRow } from "../timeline/timeline-row";
import { useMessageActions } from "../timeline/use-message-actions";
import { ThreadMessageSkeleton } from "./thread-pane-skeleton";

const PREFETCH_THRESHOLD = 5;
/**
 * With thread support off the replies live in the main room timeline, so an
 * old thread's replies can sit well behind the sync window — one page of 50
 * often isn't enough to reach them. Walk back a few pages, but bounded, so a
 * thread whose totalCount we can never satisfy doesn't paginate the whole room.
 */
const MAX_PREFETCH_PAGES = 5;
const HIGHLIGHT_MS = 2500;
const AT_BOTTOM_PX = 50;

/** The plan board for this thread, until the user dismisses that plan. */
function ThreadPlan({
  roomId,
  rootEventId,
}: {
  roomId: string;
  rootEventId: string;
}) {
  const plan = usePlan(roomId, rootEventId);
  const [collapsed, setCollapsed] = React.useState(false);
  // Keyed by session so a new plan in the same thread shows again.
  const [dismissedSessionId, setDismissedSessionId] = React.useState<
    string | null
  >(null);
  if (!plan || plan.sessionId === dismissedSessionId) return null;
  return (
    <div className="px-3 pt-1">
      <PlanBoard
        plan={plan}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
        onDismiss={() => setDismissedSessionId(plan.sessionId)}
      />
    </div>
  );
}

/**
 * A thread in the right pane: the root, its replies, and a composer bound to
 * the root. Opened from a summary row or `?thread=`; `?event=` scrolls to and
 * flashes one reply.
 */
export function ThreadPane({
  roomId,
  rootEventId,
  onClose,
  highlightEventId,
  workforceSpaceId = null,
}: {
  roomId: string;
  rootEventId: string;
  onClose: () => void;
  /** A reply to scroll to and flash, from a `?event=` link. */
  highlightEventId?: string;
  workforceSpaceId?: string | null;
}) {
  const { widthPx, onResizeStart, onResetWidth, canReset } = useAuxPanelWidth();
  const { root, rootPending, replies, replyCount, totalCount } = useThreadEntries(
    roomId,
    rootEventId,
    workforceSpaceId,
  );
  const { actions, dialogs } = useMessageActions(roomId, { inThread: true });
  const {
    loadMore,
    loading,
    hasMore: canPaginate,
  } = useLoadMoreThread(roomId, rootEventId);
  const typingUserIds = useTyping(roomId);
  const awaitingUserIds = useAwaitingInput(roomId);
  const roomName = MatrixClientPeg.safeGet()?.getRoom(roomId)?.name;

  // Two conditions, both required: the server says replies are outstanding,
  // and there's somewhere left to paginate from. Offering the button on the
  // first alone leaves a dead control on screen once we've reached the start
  // of the room and still can't account for every reply.
  const hasMore = replies.length < totalCount && canPaginate;

  const items = React.useMemo(
    () =>
      buildTimelineItems(
        replies.map((message) => ({ message, thread: null })),
      ).filter((item) => item.kind === "entry"),
    [replies],
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const atBottomRef = React.useRef(true);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const prefetchPagesRef = React.useRef({ key: "", pages: 0 });

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setIsAtBottom(true);
  }

  const [flash, setFlash] = React.useState<string | null>(null);
  const scrolledForRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!highlightEventId || scrolledForRef.current === highlightEventId)
      return;
    if (!replies.some((m) => m.id === highlightEventId)) return; // not loaded: open at the bottom
    scrolledForRef.current = highlightEventId;
    atBottomRef.current = false; // keep stick-to-bottom from yanking us away
    setFlash(highlightEventId);
    const el = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ??
        [],
    ).find((n) => n.dataset.messageId === highlightEventId);
    el?.scrollIntoView?.({ block: "center" });
  }, [highlightEventId, replies]);

  React.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // Follow new replies while the reader is at the bottom.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [replies, root]);


  // Prefetch on open: with few replies rendered and more on the server, walk
  // back a page at a time so a thread doesn't open near-empty. Bounded; past
  // that it's the user's call via the button.
  React.useEffect(() => {
    const key = `${roomId}:${rootEventId}`;
    if (prefetchPagesRef.current.key !== key)
      prefetchPagesRef.current = { key, pages: 0 };
    if (replies.length === 0 && rootPending) return; // wait for the thread to materialize
    if (loading) return;
    if (!hasMore || replies.length >= PREFETCH_THRESHOLD) return;
    if (prefetchPagesRef.current.pages >= MAX_PREFETCH_PAGES) return;
    prefetchPagesRef.current.pages += 1;
    void loadMore();
  }, [
    roomId,
    rootEventId,
    hasMore,
    replies.length,
    rootPending,
    loading,
    loadMore,
  ]);

  const replyLabel =
    replyCount > 0
      ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`
      : null;

  return (
    <AuxPanel
      label="Thread"
      testId="thread-pane"
      widthPx={widthPx}
      onResizeStart={onResizeStart}
      onResetWidth={onResetWidth}
      canResetWidth={canReset}
      onClose={onClose}
      header={
        <AuxPanelHeader
          title={
            <span className="flex min-w-0 items-baseline gap-2">
              Thread
              {roomName ? (
                <span className="truncate font-sans text-caption1 font-normal text-text-tertiary">
                  #{roomName}
                </span>
              ) : null}
            </span>
          }
        />
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="scrollbar-custom min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pt-2 pb-3"
          data-testid="message-thread-body"
        >
          {root ? (
            <TimelineRow
              entry={{ message: root, thread: null }}
              roomId={roomId}
              actions={actions}
            />
          ) : rootPending ? (
            <ThreadMessageSkeleton isHead />
          ) : (
            <p className="px-4 py-2 text-body2 text-text-tertiary italic">
              Thread root unavailable.
            </p>
          )}
          {replyLabel ? (
            <div
              className="flex items-center gap-3 px-4 py-2"
              data-testid="message-thread-replies-divider"
            >
              <span className="shrink-0 text-caption1 text-text-tertiary">
                {replyLabel}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}
          {/* Not gated on replies.length: a thread whose replies are all behind
              the sync window renders none, and that is when the button matters.
              It hides itself when idle with nothing more to fetch. */}
          <LoadMoreButton
            loading={loading}
            hasMore={hasMore}
            onClick={loadMore}
          />
          <div data-testid="message-thread-replies">
            {items.map((item) =>
              item.kind === "entry" ? (
                <TimelineRow
                  key={item.key}
                  entry={item.entry}
                  roomId={roomId}
                  actions={actions}
                  isContinuation={item.isContinuation}
                  isFollowedByContinuation={item.isFollowedByContinuation}
                  highlighted={flash === item.entry.message.id}
                />
              ) : null,
            )}
          </div>
        </div>
        {!isAtBottom ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <Button
              variant="outline"
              size="xs"
              className="pointer-events-auto rounded-pill shadow-button"
              onClick={scrollToBottom}
              data-testid="thread-scroll-to-latest"
            >
              <ArrowDownIcon className="size-3.5" />
              Jump to latest
            </Button>
          </div>
        ) : null}
      </div>
      <div className="shrink-0">
        <TypingIndicator
          typingUserIds={typingUserIds}
          awaitingUserIds={awaitingUserIds}
          roomId={roomId}
        />
        <ThreadPlan
          key={rootEventId}
          roomId={roomId}
          rootEventId={rootEventId}
        />
        <AgentActivityBar roomId={roomId} threadRootId={rootEventId} workforceSpaceId={workforceSpaceId} />
        <Composer
          roomId={roomId}
          threadRootEventId={rootEventId}
          workforceSpaceId={workforceSpaceId}
        />
      </div>
      {dialogs}
    </AuxPanel>
  );
}
