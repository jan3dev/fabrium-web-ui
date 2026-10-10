import type { Meta, StoryObj } from "@storybook/react-vite";
import { RoomStatusBadge } from "./room-status-badge";

const meta = {
  title: "Rooms/RoomStatusBadge",
  component: RoomStatusBadge,
  parameters: { layout: "centered" },
  args: { archived: true, encrypted: true },
} satisfies Meta<typeof RoomStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ArchivedAndEncrypted: Story = {};

export const Encrypted: Story = { args: { archived: false } };
