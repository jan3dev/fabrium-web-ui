import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { ActorSummary, TimelineEntry, TimelineMessage } from "@/model/types";
import { DayDivider } from "./day-divider";
import type { MessageRowActions } from "./message-row";
import { RoomIntro } from "./room-intro";
import { TimelineRow } from "./timeline-row";
import { TimelineSkeleton } from "./timeline-skeleton";
import { UnreadDivider } from "./unread-divider";
import { HashIcon } from "@/components/icons";

const MIN = 60_000;
const now = Date.now();
const roomId = "!room:example.org";

const ana: ActorSummary = { id: "@ana:example.org", kind: "human", displayName: "Ana", avatarUrl: null };
const coder: ActorSummary = { id: "@coder:example.org", kind: "agent", displayName: "Coder · Payments", avatarUrl: null };
const zooid: ActorSummary = { id: "@zooid:example.org", kind: "system", displayName: "zooid", avatarUrl: null };

function message(id: string, author: ActorSummary, body: string, minutesAgo: number, extra: Partial<TimelineMessage> = {}): TimelineMessage {
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

const actions: MessageRowActions = {
  toggleReaction: fn(),
  openThread: fn(),
  edit: fn(async () => {}),
  remove: fn(),
  share: fn(),
  copyLink: fn(),
  copyText: fn(),
  quote: fn(),
  retrySend: fn(),
  cancelSend: fn(),
  canEdit: (m) => m.author.id === ana.id,
  canDelete: (m) => m.author.id === ana.id,
};

function Row({ entry, continuation = false }: { entry: TimelineEntry; continuation?: boolean }) {
  return <TimelineRow entry={entry} roomId={roomId} actions={actions} isContinuation={continuation} />;
}

const entry = (m: TimelineMessage, thread: TimelineEntry["thread"] = null): TimelineEntry => ({ message: m, thread });

const meta = {
  title: "Timeline/Rows",
  component: TimelineRow,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TimelineRow>;

export default meta;
type Story = StoryObj<typeof meta>;

// Custom renders: each story assembles a stretch of timeline inline.
const base = { args: { entry: entry(message("$x", ana, "x", 0)), roomId, actions } };

export const Conversation: Story = {
  ...base,
  render: () => (
    <div className="max-w-2xl">
      <DayDivider label="Yesterday" />
      <Row entry={entry(message("$1", ana, "Can someone look at the failing payments test?", 30))} />
      <Row entry={entry(message("$2", ana, "It started after the retry change.", 29))} continuation />
      <UnreadDivider />
      <Row
        entry={entry(
          message("$3", coder, "On it. The retry budget is read before the config loads.", 12, {
            reactions: [
              { emoji: "👍", count: 2, reactedByMe: true, actorIds: [ana.id, zooid.id] },
              { emoji: "👀", count: 1, reactedByMe: false, actorIds: [coder.id] },
            ],
          }),
          { rootId: "$3", replyCount: 4, lastReplyAt: now - 3 * MIN, participants: [coder, ana] },
        )}
      />
      <Row entry={entry(message("$4", ana, "Fixed the typo", 2, { edited: true }))} />
      <Row entry={entry(message("$5", zooid, "Daemon restarted.", 1))} />
    </div>
  ),
};

export const SendStates: Story = {
  ...base,
  render: () => (
    <div className="max-w-2xl">
      <Row entry={entry(message("$s1", ana, "Delivered.", 3))} />
      <Row entry={entry(message("$s2", ana, "On its way…", 0, { pending: true }))} />
      <Row
        entry={entry(
          message("$s3", ana, "@agent hello", 0, { failed: true, failedReason: "You're not a member of this room yet" }),
        )}
      />
      <Row entry={entry(message("$s4", ana, "", 5, { redacted: true }))} />
    </div>
  ),
};

export const SystemRows: Story = {
  ...base,
  render: () => (
    <div className="max-w-2xl">
      <Row entry={entry(message("$m1", ana, "Ana joined", 10, { kind: "membership" }))} />
      <Row entry={entry(message("$m2", ana, 'changed the topic to "Payments rollout"', 9, { kind: "state" }))} />
      <Row entry={entry(message("$m3", zooid, "New session", 8, { kind: "divider" }))} />
      <Row entry={entry(message("gap:$m4", ana, "", 7, { kind: "gap", raw: "$m4" }))} />
    </div>
  ),
};

export const Intro: Story = {
  ...base,
  render: () => <RoomIntro name="payments" topic="Ship the retry fix by Friday" glyph={<HashIcon />} />,
};

export const Loading: Story = { ...base, render: () => <TimelineSkeleton /> };
