import type { Meta, StoryObj } from "@storybook/react-vite";
import { RoomGlyph } from "@/components/room-glyph";

const meta = {
  title: "Rooms/RoomGlyph",
  component: RoomGlyph,
  parameters: { layout: "centered" },
  args: { kind: "stream" },
} satisfies Meta<typeof RoomGlyph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Channel: Story = {};

export const PrivateChannel: Story = { args: { isPrivate: true } };

export const DirectMessage: Story = { args: { kind: "dm", dmUserId: "@ana:example.org" } };

export const AgentDirectMessage: Story = {
  args: { kind: "dm", dmUserId: "@coder.payments:example.org", isAgent: true },
};
