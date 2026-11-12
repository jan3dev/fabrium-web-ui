import type { Meta, StoryObj } from "@storybook/react-vite";
import { PreviewState } from "./preview-state";

const log = [
  "> todo-app@0.1.0 dev",
  "> vite --host 127.0.0.1 --port 24123",
  "",
  "  VITE v7.1.4  ready in 412 ms",
  "  ➜  Local:   http://127.0.0.1:24123/",
  "Error: Cannot find module './routes/todos'",
  "    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)",
].join("\n");

const meta = {
  title: "Previews/PreviewState",
  component: PreviewState,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="relative h-[480px] w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    status: "starting",
    title: "Todo app",
    agentName: "Coder · Web",
    exitCode: null,
    since: "2026-11-09T09:30:00Z",
    log,
    onRestart: () => {},
    onStop: () => {},
  },
} satisfies Meta<typeof PreviewState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = {};
export const Crashed: Story = { args: { status: "crashed", exitCode: 1, onAskFix: () => {} } };
export const Stopped: Story = { args: { status: "stopped" } };
export const StoppedNoControls: Story = {
  args: { status: "stopped", onRestart: undefined, onStop: undefined },
};
export const Offline: Story = { args: { status: "offline" } };
