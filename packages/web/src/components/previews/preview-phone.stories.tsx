import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { PreviewPhone } from "./preview-phone";

const meta = {
  title: "Previews/PreviewPhone",
  component: PreviewPhone,
  parameters: { layout: "centered" },
  args: {
    session: { url: "https://3f9c2a7e1b0d4c8f9e6a5b4c3d2e1f00.fabrium-preview.net/", expires_at: "2026-11-16T22:14:00Z" },
  },
} satisfies Meta<typeof PreviewPhone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
/** The popover open: QR code, link, Copy link, expiry. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open on phone" }));
  },
};
