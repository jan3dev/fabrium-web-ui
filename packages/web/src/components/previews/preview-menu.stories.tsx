import type { Meta, StoryObj } from "@storybook/react-vite";
import { PreviewMenu, type PreviewMenuItem } from "./preview-menu";

const todo: PreviewMenuItem = {
  agentId: "@vm1.coder:h.example",
  name: "todo-app",
  title: "Todo app",
  agentName: "Coder 🤖 · Web",
  status: "running",
  threadRoot: "$root",
};

const meta = {
  title: "Previews/PreviewMenu",
  component: PreviewMenu,
  args: { previews: [todo], onOpen: () => {} },
} satisfies Meta<typeof PreviewMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One app: the button opens it. */
export const One: Story = {};
/** Several apps: the button opens a list. */
export const Several: Story = {
  args: {
    previews: [
      todo,
      { ...todo, name: "shop", title: "Shop front", status: "starting" },
      { ...todo, agentId: "@vm2.designer:h.example", name: "landing", title: "Landing page", agentName: "Designer 🤖" },
    ],
  },
};
