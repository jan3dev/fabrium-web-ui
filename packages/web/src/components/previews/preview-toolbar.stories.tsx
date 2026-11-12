import type { Meta, StoryObj } from "@storybook/react-vite";
import { PreviewToolbar } from "./preview-toolbar";

const noop = () => {};

const meta = {
  title: "Previews/PreviewToolbar",
  component: PreviewToolbar,
  parameters: { layout: "fullscreen" },
  args: {
    path: "/todos?filter=done",
    disabled: false,
    device: "desktop",
    annotating: false,
    onNavigate: noop,
    onBack: noop,
    onForward: noop,
    onReload: noop,
    onDeviceChange: noop,
    onAnnotatingChange: noop,
    onOpenInNewTab: noop,
  },
} satisfies Meta<typeof PreviewToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const Annotating: Story = { args: { annotating: true } };
export const PhoneWidth: Story = { args: { device: "phone" } };
/** The app is not running: everything but the device width is off. */
export const NotRunning: Story = { args: { disabled: true, path: "/" } };
/** An agent viewing: no Annotate button. */
export const NoAnnotate: Story = { args: { onAnnotatingChange: undefined } };
