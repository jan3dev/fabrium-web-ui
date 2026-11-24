import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseDesignSystem } from "@/lib/artifacts/design-system";
import { DesignSystemEditor } from "./design-system-editor";

const SYSTEM = parseDesignSystem(
  JSON.stringify({
    overview: "# Northwind\n\nQuiet surfaces, one strong accent.",
    colors: [
      { name: "brand", value: "rgb(51 85 255)", description: "Primary actions" },
      { name: "ink", value: "rgb(20 20 19)" },
    ],
    spacing: [{ name: "sm", value: "8px", description: "Inside controls" }],
    components: [{ name: "Button", description: "Primary action", html: "<button>Save</button>" }],
  }),
)!;

const meta = {
  title: "Artifacts/DesignSystemEditor",
  component: DesignSystemEditor,
  parameters: { layout: "fullscreen" },
  args: { system: SYSTEM, section: "colors", onOverview: () => {}, onToken: () => {}, onComponent: () => {} },
  render: (args) => (
    <div className="h-96 max-w-xl">
      <DesignSystemEditor {...args} />
    </div>
  ),
} satisfies Meta<typeof DesignSystemEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colors: Story = {};
export const Spacing: Story = { args: { section: "spacing" } };
export const Overview: Story = { args: { section: "overview" } };
export const Components: Story = { args: { section: "components" } };
/** Assets change through the agent only. */
export const Assets: Story = { args: { section: "assets" } };
