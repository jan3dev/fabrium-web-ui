import type { Meta, StoryObj } from "@storybook/react-vite";
import { PreviewConsole } from "./preview-console";

const log = Array.from(
  { length: 40 },
  (_, i) => `[vite] page reload src/routes/todos.tsx (${i + 1})`,
).join("\n");

const errors = [
  "TypeError: Cannot read properties of undefined (reading 'map')\n    at TodoList (http://localhost/src/todo-list.tsx:12:20)",
  "Unhandled rejection: Error: GET /api/todos 500",
];

const meta = {
  title: "Previews/PreviewConsole",
  component: PreviewConsole,
  parameters: { layout: "fullscreen" },
  args: {
    log,
    errors,
    open: true,
    tab: "console",
    onOpenChange: () => {},
    onTabChange: () => {},
    onAskFix: () => {},
  },
} satisfies Meta<typeof PreviewConsole>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Errors: Story = {};
export const Logs: Story = { args: { tab: "logs" } };
export const Collapsed: Story = { args: { open: false } };
export const NoErrors: Story = { args: { errors: [] } };
export const EmptyLogs: Story = { args: { tab: "logs", log: "" } };
/** A viewer who may not ask the agent: no "Ask agent to fix". */
export const ReadOnly: Story = { args: { onAskFix: undefined } };
