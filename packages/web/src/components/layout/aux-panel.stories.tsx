import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuxPanelHeader } from "./aux-panel-header";
import { AuxPanel } from "./aux-panel-shell";

const meta = {
  title: "Layout/AuxPanel",
  component: AuxPanel,
  parameters: { layout: "fullscreen" },
  args: { label: "Members", widthPx: 380, onClose: () => {}, onResizeStart: () => {}, children: null },
  render: (args) => (
    <div className="flex h-96 border border-border">
      <div className="flex-1 p-4 text-body2 text-text-secondary">Main pane</div>
      <AuxPanel {...args} header={<AuxPanelHeader title={args.label} onBack={() => {}} />}>
        <p className="p-4 text-body2">Panel body. Drag the left edge to resize.</p>
      </AuxPanel>
    </div>
  ),
} satisfies Meta<typeof AuxPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
