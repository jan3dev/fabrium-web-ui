import type { Meta, StoryObj } from "@storybook/react-vite";
import { SpeakerNotesField } from "./speaker-notes-field";

const meta = {
  title: "Artifacts/SpeakerNotesField",
  component: SpeakerNotesField,
  args: { value: "Open with the launch date.", onCommit: () => {} },
  render: (args) => (
    <div className="max-w-xl border-t border-border pt-2">
      <SpeakerNotesField {...args} />
    </div>
  ),
} satisfies Meta<typeof SpeakerNotesField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithNotes: Story = {};
export const Empty: Story = { args: { value: "" } };
