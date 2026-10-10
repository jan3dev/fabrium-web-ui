import type { Meta, StoryObj } from "@storybook/react-vite";
import { makeFakeClient, makeRoom, mkMatrixEvent, pushTimelineEvent } from "../../../test/factories";
import { MemoryRouter } from "react-router-dom";
import { MatrixClientPeg } from "../../client/peg";
import { ThreadPane } from "./thread-pane";
import { Sidebar, SidebarInset, SidebarProvider } from "../ui/sidebar";

const ME = "@me:h.example";
const AGENT = "@architect.acme:h.example";
const ROOM_ID = "!demo:h.example";
const ROOT_EVENT_ID = "$root-message";
const LONG_ROOT_EVENT_ID = "$long-root-message";

function seedThreadWithLongCommand() {
  const client = makeFakeClient({ userId: ME });
  const room = makeRoom(ROOM_ID, { client, myUserId: ME });
  (client as unknown as { getRoom: (id: string) => unknown }).getRoom = (id: string) =>
    id === ROOM_ID ? room : null;

  const rootEvent = mkMatrixEvent({
    roomId: ROOM_ID,
    sender: ME,
    type: "m.room.message",
    content: { msgtype: "m.text", body: "commit the changes" },
    eventId: ROOT_EVENT_ID,
  });
  pushTimelineEvent(room, rootEvent);

  pushTimelineEvent(
    room,
    mkMatrixEvent({
      roomId: ROOM_ID,
      sender: AGENT,
      type: "dev.zooid.tool_call",
      content: {
        session_id: "s1",
        tool_call_id: "tc1",
        title: "Terminal",
        kind: "execute",
        raw_input: {
          command: "git -C /Users/ori/Code/z/zooid-clients add packages/web/src/components/timeline/approval-card-view.tsx packages/web/src/components/timeline/formatted-message-body.tsx packages/web/src/components/structures/timeline-panel.diff.stories.tsx",
          description: "Stage changed files",
        },
        "m.relates_to": { rel_type: "m.thread", event_id: ROOT_EVENT_ID },
      },
    }),
  );

  pushTimelineEvent(
    room,
    mkMatrixEvent({
      roomId: ROOM_ID,
      sender: AGENT,
      type: "dev.zooid.tool_call_update",
      content: {
        session_id: "s1",
        tool_call_id: "tc1",
        status: "completed",
        "m.relates_to": { rel_type: "m.thread", event_id: ROOT_EVENT_ID },
      },
    }),
  );

  MatrixClientPeg.injectClientForTest(client);
}

function seedThreadWithLongRootMessage() {
  const client = makeFakeClient({ userId: ME });
  const room = makeRoom(ROOM_ID, { client, myUserId: ME });
  (client as unknown as { getRoom: (id: string) => unknown }).getRoom = (id: string) =>
    id === ROOM_ID ? room : null;

  const paragraphs = [
    "Here's the plan for the migration, broken into steps so we can review each one independently before merging.",
    "First, we need to add the new column as nullable so existing rows aren't affected during the rollout window.",
    "Second, backfill the column in batches, throttled so it doesn't compete with production traffic for I/O.",
    "Third, flip the application code to read from the new column behind a feature flag we can roll back quickly.",
    "Fourth, once the flag has been at 100% for a week with no incidents, drop the old column and remove the flag.",
    "Let me know if any step looks risky and we can split it further or add an extra verification pass.",
  ];
  const rootEvent = mkMatrixEvent({
    roomId: ROOM_ID,
    sender: AGENT,
    type: "m.room.message",
    content: { msgtype: "m.text", body: paragraphs.join("\n\n") },
    eventId: LONG_ROOT_EVENT_ID,
  });
  pushTimelineEvent(room, rootEvent);

  pushTimelineEvent(
    room,
    mkMatrixEvent({
      roomId: ROOM_ID,
      sender: ME,
      type: "m.room.message",
      content: {
        msgtype: "m.text",
        body: "sounds good, go ahead",
        "m.relates_to": { rel_type: "m.thread", event_id: LONG_ROOT_EVENT_ID },
      },
    }),
  );

  MatrixClientPeg.injectClientForTest(client);
}

const meta = {
  title: "Structures/ThreadPane",
  component: ThreadPane,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="flex h-svh justify-end">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof ThreadPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLongCommand: Story = {
  args: { roomId: ROOM_ID, rootEventId: ROOT_EVENT_ID, onClose: () => {} },
  render: (args) => {
    seedThreadWithLongCommand();
    return <ThreadPane {...args} />;
  },
};

// A long thread root (issue #27). The pane shows the root in full.
export const WithLongRootMessage: Story = {
  args: { roomId: ROOM_ID, rootEventId: LONG_ROOT_EVENT_ID, onClose: () => {} },
  render: (args) => {
    seedThreadWithLongRootMessage();
    return <ThreadPane {...args} />;
  },
};

// Regression for the "tool card stretches the whole pane" bug: the pane sits
// beside the main column in the real LoggedInView chain, and a wide,
// unbreakable command in a tool-call card must stay inside it.
export const InLayoutChain: Story = {
  args: { roomId: ROOM_ID, rootEventId: ROOT_EVENT_ID, onClose: () => {} },
  render: (args) => {
    seedThreadWithLongCommand();
    return (
      <SidebarProvider>
        <Sidebar />
        <SidebarInset>
          <div className="relative flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-hidden p-4 text-body2 text-text-tertiary">Timeline</div>
            <ThreadPane {...args} />
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  },
};
