import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { DesignSystemEntry, DesignSystemPrefs } from "@/model/types";
import { DesignSystemsSection } from "./design-systems-section";

const SYSTEMS: DesignSystemEntry[] = [
  { roomId: "!design:example.org", threadId: "$a", identifier: "brand", name: "Brand 2026", isDefault: true },
  { roomId: "!design:example.org", threadId: "$b", identifier: "pitch", name: "Pitch decks", isDefault: true, for: ["slides"] },
  { roomId: "!web:example.org", threadId: "$c", identifier: "docs-site", name: "Docs site", isDefault: false },
];

function Live(props: { canManage: boolean; workspace: DesignSystemEntry[] }) {
  const [workspace, setWorkspace] = useState(props.workspace);
  const [prefs, setPrefs] = useState<DesignSystemPrefs>({ off: false });
  return (
    <div className="max-w-md">
      <DesignSystemsSection
        workspace={workspace}
        prefs={prefs}
        canManage={props.canManage}
        onChangeWorkspace={setWorkspace}
        onChangePrefs={setPrefs}
      />
    </div>
  );
}

const meta = {
  title: "Settings/DesignSystemsSection",
  component: Live,
  args: { canManage: true, workspace: SYSTEMS },
} satisfies Meta<typeof Live>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An owner or admin: sets defaults, scopes a system to slides, removes one. */
export const Manager: Story = {};

/** A member reads the list and picks only their own default. */
export const Member: Story = { args: { canManage: false } };

export const Empty: Story = { args: { workspace: [] } };
