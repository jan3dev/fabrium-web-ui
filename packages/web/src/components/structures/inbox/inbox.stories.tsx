import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { fn } from "storybook/test";
import { ApprovalCardView } from "@/components/timeline/approval-card-view";
import type { MessageRowActions } from "@/components/timeline/message-row";
import { TimelineRow } from "@/components/timeline/timeline-row";
import type { InboxItem } from "@/model/inbox";
import type { ActorSummary, TimelineMessage } from "@/model/types";
import { InboxDetailPane } from "./inbox-detail-pane";
import { type InboxFilter, InboxListPane } from "./inbox-list-pane";
import { InboxListSkeleton } from "./inbox-skeleton";

const MIN = 60_000;
const now = Date.now();
const roomId = "!room:example.org";
const ana: ActorSummary = {
  id: "@ana:example.org",
  kind: "human",
  displayName: "Ana",
  avatarUrl: null,
};
const coder: ActorSummary = {
  id: "@coder:example.org",
  kind: "agent",
  displayName: "Coder · Payments",
  avatarUrl: null,
};

function message(
  id: string,
  author: ActorSummary,
  body: string,
  minutesAgo: number,
  extra: Partial<TimelineMessage> = {},
): TimelineMessage {
  return {
    id,
    kind: "message",
    createdAt: now - minutesAgo * MIN,
    author,
    body,
    threadRootId: null,
    replyToId: null,
    edited: false,
    pending: false,
    failed: false,
    redacted: false,
    reactions: [],
    ...extra,
  };
}

const items: InboxItem[] = [
  {
    id: "$ap",
    category: "needs_action",
    roomId,
    roomName: "payments",
    message: message("$ap", coder, "", 2, {
      kind: "approval",
      threadRootId: "$root",
    }),
    preview: "Wants to use bash",
    unread: true,
  },
  {
    id: "$q",
    category: "needs_action",
    roomId,
    roomName: "payments",
    message: message("$q", coder, "", 9, { kind: "question" }),
    preview: "Which branch should the release go to?",
    unread: true,
  },
  {
    id: "$m",
    category: "mention",
    roomId,
    roomName: "design",
    message: message(
      "$m",
      ana,
      "@me can you look at the new invoice layout before Friday?",
      45,
    ),
    preview: "@me can you look at the new invoice layout before Friday?",
    unread: true,
  },
  {
    id: "$t",
    category: "activity",
    roomId,
    roomName: "general",
    message: message("$t", ana, "Merged, thanks!", 300, {
      threadRootId: "$root2",
    }),
    preview: "Merged, thanks!",
    unread: true,
  },
  {
    id: "$m2",
    category: "mention",
    roomId,
    roomName: "general",
    message: message("$m2", ana, "Thanks @me", 3000),
    preview: "Thanks @me",
    unread: false,
  },
];

function ListStory({
  items,
  mentions = "ready",
}: {
  items: InboxItem[];
  mentions?: "loading" | "ready" | "unsupported" | "error";
}) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>("$ap");
  return (
    <div className="h-[560px] w-[365px] border border-border">
      <InboxListPane
        className="h-full"
        filter={filter}
        hasMoreMentions={mentions === "ready"}
        items={items}
        mentions={mentions}
        onFilterChange={setFilter}
        onLoadMoreMentions={fn()}
        onOpen={fn()}
        onSelect={(i) => setSelectedId(i.id)}
        selectedId={selectedId}
      />
    </div>
  );
}

const meta = {
  title: "Inbox/Inbox",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = { render: () => <ListStory items={items} /> };
export const ListEmpty: Story = { render: () => <ListStory items={[]} /> };
export const ListLoading: Story = {
  render: () => <ListStory items={[]} mentions="loading" />,
};
export const ListMentionsUnsupported: Story = {
  render: () => (
    <ListStory
      items={items.filter((i) => i.category !== "mention")}
      mentions="unsupported"
    />
  ),
};
export const Skeleton: Story = { render: () => <InboxListSkeleton /> };

const actions: MessageRowActions = {
  toggleReaction: fn(),
  edit: fn(async () => {}),
  remove: fn(),
  share: fn(),
  copyLink: fn(),
  copyText: fn(),
  quote: fn(),
  retrySend: fn(),
  cancelSend: fn(),
  canEdit: () => false,
  canDelete: () => false,
};

export const DetailMessage: Story = {
  render: () => (
    <MemoryRouter>
      <div className="flex h-[360px] w-[640px] border border-border">
        <InboxDetailPane item={items[2]!} onOpen={fn()}>
          <TimelineRow
            actions={actions}
            entry={{ message: items[2]!.message, thread: null }}
            roomId={roomId}
          />
        </InboxDetailPane>
      </div>
    </MemoryRouter>
  ),
};

export const DetailApprovalMobile: Story = {
  render: () => (
    <div className="flex h-[480px] w-[375px] border border-border">
      <InboxDetailPane item={items[0]!} onBack={fn()} onOpen={fn()}>
        <div className="px-3">
          <ApprovalCardView
            agentName="Coder · Payments"
            detail={JSON.stringify({ command: "pnpm run test" }, null, 2)}
            onRespond={fn()}
            options={[
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ]}
            subtitle="pnpm run test"
            title="bash"
          />
        </div>
      </InboxDetailPane>
    </div>
  ),
};
