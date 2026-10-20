import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ArtifactRef } from "@/lib/artifacts/refs";
import { ArtifactRefChips, ArtifactRefList } from "./artifact-refs";

const refs: ArtifactRef[] = [
  {
    identifier: "pricing-page",
    title: "Pricing page",
    version: 2,
    event_id: "$v2",
    target: { kind: "element", selector: "section.plans > div.card:nth-of-type(2) > button", html: "<button>Buy</button>", text: "Buy" },
    note: "Make the middle plan's button the primary color.",
  },
  {
    identifier: "readme",
    title: "Readme",
    version: 1,
    event_id: "$v1",
    target: { kind: "text", text: "Run the installer with sudo and restart the machine.", where: 'section "Setup"' },
    note: "",
  },
];

const meta = {
  title: "Artifacts/ArtifactRefs",
  component: ArtifactRefList,
  parameters: { layout: "padded" },
  args: { refs, onOpen: () => {} },
} satisfies Meta<typeof ArtifactRefList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In a sent reply. */
export const InMessage: Story = {};

/** Waiting in the composer. */
export const ComposerChips: Story = {
  render: (args) => <ArtifactRefChips refs={args.refs} onRemove={() => {}} />,
};
