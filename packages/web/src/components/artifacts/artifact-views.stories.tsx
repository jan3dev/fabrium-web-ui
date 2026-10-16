import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { ArtifactPreview } from "./artifact-preview";
import { ArtifactTextView } from "./artifact-text-view";

const MARKDOWN = `# Rollout plan

## Setup

Run the migration, then flip the flag for **internal** users.

## Risks

- Webhook retries can double-charge.
- The old client caches prices for 24 hours.
`;

const CODE = `def total(items):
    subtotal = sum(i.price * i.qty for i in items)
    return round(subtotal * 1.19, 2)
`;

const HTML = `<!doctype html><html><head><style>
body{font-family:system-ui;padding:24px} .card{border:1px solid gainsboro;border-radius:12px;padding:16px;max-width:280px}
button{margin-top:12px;padding:8px 14px;border-radius:8px;border:0;background:black;color:white}
</style></head><body><div class="card"><h2>Pro</h2><p>For growing teams.</p><button class="cta">Buy</button></div></body></html>`;

const meta = {
  title: "Artifacts/ArtifactViews",
  component: ArtifactTextView,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ height: 420 }}><Story /></div>],
  args: { kind: "markdown", text: MARKDOWN, roomId: "!r:h.example", annotating: false, onPicked: () => {} },
} satisfies Meta<typeof ArtifactTextView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {};
export const DocumentAnnotating: Story = { args: { annotating: true } };
export const Code: Story = { args: { kind: "code", text: CODE } };

/** The sandboxed frame; click "annotating" in controls to try pick mode. */
export const Preview: Story = {
  args: { annotating: false },
  render: (args) => (
    <ArtifactPreview
      kind="html"
      srcdoc={buildArtifactSrcdoc("html", HTML, "story")}
      channel="story"
      title="Pricing card"
      annotating={args.annotating}
      onPicked={args.onPicked}
      onError={() => {}}
      onOpenLink={() => {}}
    />
  ),
};
