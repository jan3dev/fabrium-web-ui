import type { Meta, StoryObj } from "@storybook/react-vite";
import { slideLayouts, withFrames } from "@/lib/artifacts/edit";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { LayoutPicker } from "./layout-picker";

const CHANNEL = "story-layouts";
/** A deck with its own design and one agent-made layout (Table); the rest are built in the app. */
const DECK = `<!doctype html><html><head><style>
section{display:flex;flex-direction:column;justify-content:center;gap:24px;padding:96px;font:32px/1.4 Georgia,serif;background:rgb(250,246,238);color:rgb(40,30,20)}
h1,h2{margin:0;color:rgb(160,60,30)} table{border-collapse:collapse} td,th{border:2px solid rgb(160,60,30);padding:12px 24px}
</style>
<template data-layout="table"><section class="deck"><h2>Quarterly numbers</h2><table><tr><th>Q1</th><th>Q2</th></tr><tr><td>12</td><td>18</td></tr></table></section></template>
</head><body><section class="deck"><h1>Launch plan</h1></section></body></html>`;
const LAYOUTS = slideLayouts(DECK, 0);
const SRCDOC = buildArtifactSrcdoc("slides", withFrames(DECK, LAYOUTS.map((l) => l.section)), CHANNEL);

const meta = {
  title: "Artifacts/LayoutPicker",
  component: LayoutPicker,
  args: { open: true, layouts: LAYOUTS, srcdoc: SRCDOC, channel: CHANNEL, onPick: () => {}, onOpenChange: () => {} },
} satisfies Meta<typeof LayoutPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InTheDecksDesign: Story = {};
