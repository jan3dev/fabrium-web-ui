import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ActorSummary } from "@/model/types";
import { ThreadSummaryRow } from "./thread-summary-row";

const actor = (id: string, kind: ActorSummary["kind"] = "human"): ActorSummary => ({
  id,
  kind,
  displayName: id.slice(1, id.indexOf(":")),
  avatarUrl: null,
});

const meta = {
  title: "Timeline/ThreadSummaryRow",
  component: ThreadSummaryRow,
  parameters: { layout: "padded" },
  args: {
    onOpen: () => {},
    thread: {
      rootId: "$root",
      replyCount: 3,
      lastReplyAt: Date.now() - 5 * 60_000,
      participants: [actor("@ana:h.example"), actor("@coder:h.example", "agent"), actor("@bo:h.example")],
    },
  },
} satisfies Meta<typeof ThreadSummaryRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OneReply: Story = {
  args: {
    thread: { rootId: "$root", replyCount: 1, lastReplyAt: Date.now() - 30_000, participants: [actor("@ana:h.example")] },
  },
};
