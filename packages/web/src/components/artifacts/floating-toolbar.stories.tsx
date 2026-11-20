import type { Meta, StoryObj } from "@storybook/react-vite";
import { FloatingToolbar } from "./floating-toolbar";

const meta = {
  title: "Artifacts/FloatingToolbar",
  component: FloatingToolbar,
  args: {
    rect: { x: 40, y: 80, w: 320, h: 120 },
    values: { "background-color": "rgb(51, 85, 255)", color: "rgb(255, 255, 255)", "font-size": "40px" },
    onChange: () => {},
    onDuplicate: () => {},
    onDelete: () => {},
  },
  render: (args) => (
    <div className="relative h-64 w-[480px] rounded-card border border-border">
      <FloatingToolbar {...args} />
    </div>
  ),
} satisfies Meta<typeof FloatingToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OverTheSelection: Story = {};
/** No room above: the toolbar sits under the selection. */
export const AtTheTop: Story = { args: { rect: { x: 40, y: 8, w: 320, h: 120 } } };
/** On a phone: retype and delete only, styles in the Properties sheet. */
export const Phone: Story = { args: { onChange: undefined, onDuplicate: undefined } };
