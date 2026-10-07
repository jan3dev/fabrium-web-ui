import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "@/components/ui/badge";

const TONES = [
  "neutral",
  "success",
  "warning",
  "danger",
  "brand",
  "outline",
  "agent",
  "human",
  "system",
  "enclave",
] as const;

const meta = {
  title: "UI/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: { children: "Badge" },
  argTypes: { tone: { control: "select", options: TONES } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};
