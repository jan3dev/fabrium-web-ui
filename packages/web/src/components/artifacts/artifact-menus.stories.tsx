import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ActorSummary } from "@/model/types";
import { ArtifactTitleMenu, FrameMenu, NameDialog, SizeDialog, VersionMenu } from "./artifact-menus";

const meta = {
  title: "Artifacts/Menus",
  component: FrameMenu,
  args: { kind: "slides", index: 2, count: 5, onAction: () => {} },
  render: (args) => (
    <div className="p-4">
      <FrameMenu {...args} />
    </div>
  ),
} satisfies Meta<typeof FrameMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SlideMenu: Story = { args: { open: true } };

export const SkippedSlide: Story = { args: { open: true, skip: true } };

/** The last slide of a one-slide deck: no move, no delete. */
export const OnlySlide: Story = { args: { open: true, index: 0, count: 1 } };

export const ArtboardMenu: Story = { args: { open: true, kind: "design" } };

const agent: ActorSummary = { id: "@coder:h", kind: "agent", displayName: "Coder 🤖 · Web", avatarUrl: null };
const ana: ActorSummary = { id: "@ana:h", kind: "human", displayName: "Ana", avatarUrl: null };
const VERSIONS = [
  { eventId: "$1", version: 1, author: agent, edited: { by: ana, at: Date.now() - 3 * 60_000, saves: 3, summary: "Moved slide 3" } },
  { eventId: "$2", version: 2, author: agent, summary: "Edited slide 2" },
  { eventId: "$3", version: 3, author: agent, edited: { by: ana, at: Date.now() - 30_000, saves: 1, summary: "Skipped slide 1" } },
];

export const Versions: Story = {
  render: function List() {
    const [current, setCurrent] = useState("$3");
    return (
      <div className="flex justify-end p-4">
        <VersionMenu versions={VERSIONS} current={current} onSelect={setCurrent} />
      </div>
    );
  },
};

export const TitleMenu: Story = {
  render: () => (
    <div className="w-72 p-4">
      <ArtifactTitleMenu title="Launch deck" older onRename={() => {}} onDuplicate={() => {}} onRestore={() => {}} />
    </div>
  ),
};

/** A design system, for an owner or admin: list it for the workspace (spec §5.6). */
export const DesignSystemTitleMenu: Story = {
  render: () => (
    <div className="w-72 p-4">
      <ArtifactTitleMenu
        title="Brand 2026"
        older={false}
        onRename={() => {}}
        onDuplicate={() => {}}
        onRestore={() => {}}
        onAddToWorkspace={() => {}}
      />
    </div>
  ),
};

export const Rename: Story = {
  render: () => (
    <NameDialog open title="Rename slide 3" value="Pricing" optional maxLength={120} onSubmit={() => {}} onOpenChange={() => {}} />
  ),
};

export const CustomSize: Story = {
  render: () => (
    <SizeDialog open title="Add artboard" value={{ width: 1440, height: 900 }} onSubmit={() => {}} onOpenChange={() => {}} />
  ),
};
