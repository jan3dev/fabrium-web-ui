import { useRef, useState } from "react";
import {
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router-dom";

import { TimelineRow } from "@/components/timeline/timeline-row";
import { useMessageActions } from "@/components/timeline/use-message-actions";
import { useInbox, useInboxMessage } from "@/hooks/use-inbox";
import { useInboxListWidth } from "@/hooks/use-inbox-list-width";
import { useIsMobile } from "@/hooks/use-mobile";
import type { InboxItem } from "@/model/inbox";
import type { LoggedInOutletContext } from "../logged-in-view";
import { InboxDetailPane } from "./inbox-detail-pane";
import { type InboxFilter, InboxListPane } from "./inbox-list-pane";

/** `/inbox`: resolves the workforce space from the logged-in Outlet context. */
export function InboxRoute() {
  const { spaceId } = useOutletContext<LoggedInOutletContext>();
  return <InboxView workforceSpaceId={spaceId} />;
}

function roomLink(item: InboxItem): string {
  const params = new URLSearchParams();
  if (item.message.threadRootId)
    params.set("thread", item.message.threadRootId);
  params.set("event", item.id);
  return `/room/${item.roomId}?${params}`;
}

function InboxDetailBody({
  item,
  workforceSpaceId,
}: {
  item: InboxItem;
  workforceSpaceId: string | null;
}) {
  const live = useInboxMessage(item.roomId, item.id, workforceSpaceId);
  const { actions, dialogs } = useMessageActions(item.roomId, {
    inThread: true,
  });
  return (
    <>
      <TimelineRow
        actions={actions}
        entry={{ message: live ?? item.message, thread: null }}
        roomId={item.roomId}
      />
      {dialogs}
    </>
  );
}

/** List of what needs the viewer across rooms, and the selected item beside it (or instead of it on mobile). */
export function InboxView({
  workforceSpaceId,
}: {
  workforceSpaceId: string | null;
}) {
  const inbox = useInbox(workforceSpaceId);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { widthPx, onResizeStart, onResetWidth } = useInboxListWidth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<InboxFilter>("all");
  // The last selected item, so it stays open after it leaves the list (an approval just answered).
  const held = useRef<InboxItem | null>(null);

  const selectedId = searchParams.get("item");
  const fromList = inbox.items.find((i) => i.id === selectedId);
  if (fromList) held.current = fromList;
  const selected = fromList ?? (held.current?.id === selectedId ? held.current : null);

  const select = (item: InboxItem | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (item) next.set("item", item.id);
        else next.delete("item");
        return next;
      },
      { replace: !isMobile },
    );
  };
  const open = (item: InboxItem) => navigate(roomLink(item));

  const list = (
    <InboxListPane
      className={isMobile ? "flex-1" : "shrink-0"}
      filter={filter}
      hasMoreMentions={inbox.hasMoreMentions}
      items={inbox.items}
      mentions={inbox.mentions}
      onFilterChange={setFilter}
      onLoadMoreMentions={inbox.loadMoreMentions}
      onOpen={open}
      onSelect={select}
      selectedId={selected?.id ?? null}
      style={isMobile ? undefined : { width: widthPx }}
    />
  );
  const detail = selected ? (
    <InboxDetailPane
      item={selected}
      onBack={isMobile ? () => select(null) : undefined}
      onOpen={() => open(selected)}
    >
      <InboxDetailBody
        item={selected}
        key={selected.id}
        workforceSpaceId={workforceSpaceId}
      />
    </InboxDetailPane>
  ) : null;

  if (isMobile)
    return <div className="flex h-full min-h-0">{detail ?? list}</div>;

  return (
    <div className="flex h-full min-h-0" data-testid="inbox-view">
      {list}
      <div className="relative flex min-w-0 flex-1 border-l border-border">
        <button
          aria-label="Resize inbox list"
          className="group/inbox-resize absolute inset-y-0 left-0 z-40 w-3 -translate-x-1/2 cursor-col-resize"
          onDoubleClick={onResetWidth}
          onPointerDown={onResizeStart}
          tabIndex={-1}
          title="Drag to resize. Double-click to reset width."
          type="button"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/inbox-resize:bg-border" />
        </button>
        {detail ?? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-body2 text-text-secondary">
            Select an item to see it here.
          </div>
        )}
      </div>
    </div>
  );
}
