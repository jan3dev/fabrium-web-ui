import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExportMenu } from "./export-menu";

const meta = {
  title: "Artifacts/ExportMenu",
  component: ExportMenu,
  parameters: { layout: "centered" },
  args: { kind: "slides", extension: "html", onDownload: () => {}, onPdf: () => {}, onAsk: () => {} },
} satisfies Meta<typeof ExportMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Slides: Story = {};
export const Design: Story = { args: { kind: "design" } };
export const Whiteboard: Story = { args: { kind: "whiteboard", extension: "json", onPdf: undefined } };
export const Motion: Story = { args: { kind: "motion", onPdf: undefined } };
/** An older version is open: the agent reads only the latest. */
export const OlderVersion: Story = { args: { askBlocked: "Open the latest version to ask the agent." } };
/** An agent viewing, or nobody to ask: the app's files only. */
export const NoAgent: Story = { args: { onAsk: undefined } };
