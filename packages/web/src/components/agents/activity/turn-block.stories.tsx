import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AgentTurn, ToolTranscriptItem, TranscriptItem } from "@/model/agent-activity";
import { TurnBlock } from "./turn-block";

const now = Date.now();
const tool = (over: Partial<ToolTranscriptItem>): ToolTranscriptItem => ({
  type: "tool",
  id: Math.random().toString(36),
  title: "Tool",
  toolKind: "other",
  status: "completed",
  rawInput: null,
  content: null,
  diffs: [],
  locations: [],
  startedAt: now - 40_000,
  lastActivityAt: now - 38_000,
  ...over,
});

const items: TranscriptItem[] = [
  tool({ toolKind: "read", title: "Read auth.ts", rawInput: { file_path: "/repo/src/auth.ts" }, content: "export function login() {}" }),
  tool({
    toolKind: "edit",
    title: "Edit auth.ts",
    rawInput: {
      file_path: "/repo/src/auth.ts",
      old_string: "export function login() {}\n",
      new_string: "export async function login(user: string) {\n  return fetch('/login')\n}\n",
    },
  }),
  tool({ toolKind: "execute", title: "Run tests", rawInput: { command: "pnpm test auth" }, content: "✓ 12 tests passed" }),
  { type: "plan", id: "plan", updatedAt: now, entries: [
    { content: "Read the auth module", status: "completed" },
    { content: "Make login async", status: "completed" },
    { content: "Run the tests", status: "in_progress" },
  ] },
];

const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  id: "t1",
  sessionId: "s1",
  agent: { id: "@coder:h.example", kind: "agent", displayName: "Coder · Payments", avatarUrl: null },
  threadRootId: "$root",
  items,
  startedAt: now - 42_000,
  endedAt: now,
  ...over,
});

const meta = {
  title: "Agents/TurnBlock",
  component: TurnBlock,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TurnBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ended: Story = { args: { turn: turn({}) } };

export const Running: Story = {
  args: {
    turn: turn({
      endedAt: null,
      items: [...items.slice(0, 2), tool({ toolKind: "execute", status: "in_progress", rawInput: { command: "pnpm test auth" } })],
    }),
  },
};

export const FailedAndStalled: Story = {
  args: {
    turn: turn({
      endedAt: null,
      items: [
        tool({ toolKind: "execute", status: "failed", rawInput: { command: "pnpm build" }, content: "error TS2304: Cannot find name 'x'" }),
        tool({ toolKind: "fetch", status: "in_progress", rawInput: { url: "https://example.com/spec" }, lastActivityAt: now - 10 * 60_000 }),
      ],
    }),
  },
};
