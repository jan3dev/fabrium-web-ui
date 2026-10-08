import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmojiAutocomplete } from "./emoji-autocomplete";
import { MentionAutocomplete } from "./mention-autocomplete";
import { RoomAutocomplete } from "./room-autocomplete";
import { SlashCommandList } from "./slash-command-list";

const noop = () => {};

const meta = {
  title: "Rooms/Autocomplete",
  component: MentionAutocomplete,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[28rem]">
        <Story />
      </div>
    ),
  ],
  args: {
    selectedIndex: 0,
    onSelect: noop,
    suggestions: [
      { userId: "@coder:h.example", displayName: "Coder · Payments", isAgent: true },
      { userId: "@ana:h.example", displayName: "Ana Ruiz", isAgent: false },
      { userId: "@bo:h.example", displayName: "Bo", isAgent: false },
    ],
  },
} satisfies Meta<typeof MentionAutocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mentions: Story = {};

export const Rooms: Story = {
  render: () => (
    <RoomAutocomplete
      selectedIndex={1}
      onSelect={noop}
      suggestions={[
        { roomId: "!a:h", name: "general" },
        { roomId: "!b:h", name: "payments-release" },
      ]}
    />
  ),
};

export const Emoji: Story = {
  render: () => (
    <EmojiAutocomplete
      selectedIndex={0}
      onSelect={noop}
      suggestions={[
        { id: "thumbsup", native: "👍" },
        { id: "thinking_face", native: "🤔" },
      ]}
    />
  ),
};

export const SlashCommands: Story = {
  render: () => (
    <SlashCommandList
      activeIdx={0}
      onSelect={noop}
      onHover={noop}
      commands={[
        { name: "stop", description: "Stop the agent's current turn in this thread", source: "client" },
        { name: "plan", description: "Switch to plan mode", source: "agent" },
      ]}
    />
  ),
};
