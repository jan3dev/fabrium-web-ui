import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ArtifactVersion } from "@/model/types";
import { ArtifactCard } from "./artifact-card";

const artifact: ArtifactVersion = {
  eventId: "$v1",
  identifier: "pricing-page",
  kind: "html",
  title: "Pricing page",
  body: "<h1>Pricing</h1>",
  version: 1,
  createdAt: Date.UTC(2026, 9, 16, 9, 30),
  author: { id: "@ws.coder:h.example", kind: "agent", displayName: "Coder · Payments", avatarUrl: null },
  threadRootId: "$root",
};

const meta = {
  title: "Artifacts/ArtifactCard",
  component: ArtifactCard,
  parameters: { layout: "padded" },
  args: { artifact, onOpen: () => {} },
} satisfies Meta<typeof ArtifactCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WebPage: Story = {};
export const Active: Story = { args: { active: true } };
export const ComponentV3: Story = {
  args: { artifact: { ...artifact, kind: "react", title: "Signup form", version: 3 } },
};
export const Code: Story = {
  args: { artifact: { ...artifact, kind: "code", language: "python", title: "Invoice parser" } },
};
export const LongTitle: Story = {
  args: { artifact: { ...artifact, kind: "markdown", title: "Quarterly planning document for the payments team, draft two" } },
};
