import { type ComponentProps, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  designSystemSectionPage,
  designSystemSections,
  parseDesignSystem,
  type DesignSystem,
  type DesignSystemSection,
} from "@/lib/artifacts/design-system";
import { buildArtifactSrcdoc, PREVIEW_SANDBOX } from "@/lib/artifacts/srcdoc";
import { DesignSystemNav } from "./design-system-nav";

const FULL = parseDesignSystem(
  JSON.stringify({
    overview: "# Northwind\n\nQuiet surfaces, one strong accent, generous spacing.",
    colors: [
      { name: "brand", value: "rgb(51 85 255)", description: "Primary actions" },
      { name: "ink", value: "rgb(20 20 19)", description: "Body text" },
      { name: "paper", value: "rgb(250 249 245)" },
      { name: "danger", value: "rgb(220 38 38)" },
    ],
    spacing: [
      { name: "xs", value: "4px" },
      { name: "sm", value: "8px" },
      { name: "md", value: "16px" },
      { name: "lg", value: "32px" },
    ],
    typography: [
      { name: "h1", value: "600 32px/1.2 system-ui, sans-serif" },
      { name: "body", value: "400 16px/1.5 system-ui, sans-serif" },
    ],
    radius: [
      { name: "control", value: "8px" },
      { name: "card", value: "12px" },
      { name: "pill", value: "999px" },
    ],
    shadows: [
      { name: "surface", value: "0 1px 2px rgb(0 0 0 / 0.2)" },
      { name: "modal", value: "0 12px 32px rgb(0 0 0 / 0.25)" },
    ],
    components: [
      {
        name: "Button",
        description: "Primary action",
        html: '<button style="font:var(--font-body);padding:var(--spacing-sm) var(--spacing-md);border:0;border-radius:var(--radius-pill);background:var(--color-brand);color:white">Save</button>',
      },
    ],
    assets: [
      {
        name: "Logo",
        svg: '<svg viewBox="0 0 40 40" width="64" height="64"><circle cx="20" cy="20" r="18" fill="rgb(51 85 255)"/></svg>',
      },
    ],
  }),
)!;

const SPARSE = parseDesignSystem(
  JSON.stringify({
    colors: [
      { name: "brand", value: "rgb(51 85 255)" },
      { name: "ink", value: "rgb(20 20 19)" },
    ],
    radius: [{ name: "card", value: "12px" }],
  }),
)!;

/** The stage the panel would pass: the overview as text, any other section in a sandboxed frame. */
function Stage({ system, section }: { system: DesignSystem; section: DesignSystemSection }) {
  if (section === "overview") return <pre className="p-4 text-body2 whitespace-pre-wrap">{system.overview}</pre>;
  return (
    <iframe
      title="Design system"
      sandbox={PREVIEW_SANDBOX}
      srcDoc={buildArtifactSrcdoc("html", designSystemSectionPage(system, section), "story")}
      className="size-full border-0"
    />
  );
}

const meta = {
  title: "Artifacts/DesignSystemNav",
  component: DesignSystemNav,
  parameters: { layout: "fullscreen" },
  args: {
    system: FULL,
    sections: [],
    section: "overview",
    onSectionChange: () => {},
    onAdd: () => {},
  },
  render: function Interactive(args) {
    const sections = designSystemSections(args.system);
    const [section, setSection] = useState(sections[0]?.key ?? "overview");
    return (
      <div className="flex h-screen max-w-xl flex-col border-r border-border">
        <DesignSystemNav {...args} sections={sections} section={section} onSectionChange={setSection} />
        <div className="min-h-0 flex-1">
          <Stage system={args.system} section={section} />
        </div>
      </div>
    );
  },
} satisfies Meta<ComponentProps<typeof DesignSystemNav> & { system: DesignSystem }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {};
/** Two sections: the nav shows only those. */
export const Sparse: Story = { args: { system: SPARSE } };
/** As an agent sees it: no Add control. */
export const WithoutAdd: Story = { args: { onAdd: undefined } };
