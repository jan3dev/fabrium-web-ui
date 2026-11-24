import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ArtifactComment } from "@/lib/artifacts/comments";
import { CommentList, FramePins } from "./artifact-comments";
import { AnnotationForm } from "./artifact-refs";

const TARGET = { kind: "element", selector: "section:nth-of-type(2) > h1", html: "<h1></h1>", text: "" } as const;

const comment = (id: string, name: string, selector: string, note: string): ArtifactComment => ({
  id,
  messageId: id.split(":")[0]!,
  author: { id: `@${name.toLowerCase()}:test`, kind: "human", displayName: name, avatarUrl: null },
  text: "",
  ref: {
    identifier: "launch-deck",
    title: "Launch deck",
    version: 3,
    event_id: "$v3",
    target: { kind: "element", selector, html: "<h1></h1>", text: "" },
    note,
  },
});

const meta = {
  title: "Artifacts/ArtifactComments",
  component: CommentList,
  parameters: { layout: "padded" },
  // The side panel's width.
  decorators: [(Story) => <div className="w-64">{Story()}</div>],
  args: {
    comments: [
      comment("$a:0", "Ana", "section:nth-of-type(2) > h1", "Shorter title, please."),
      comment("$b:0", "Bo", "section:nth-of-type(2) > p", "This number is from last year."),
    ],
    onShow: () => {},
    onResolve: () => {},
  },
} satisfies Meta<typeof CommentList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Comments tab's list, as a human sees it. */
export const List: Story = {};

/** An agent sees no Resolve: only humans resolve. */
export const ListForAgent: Story = { args: { onResolve: undefined } };

export const Empty: Story = { args: { comments: [] } };

/** Over a frame: two comments on one element stack; the agent cursor on another. */
export const Pins: Story = {
  render: () => (
    <div className="relative h-80 w-[36rem] rounded-card border border-border bg-surface-secondary">
      <div className="absolute top-16 left-10 h-12 w-72 rounded-utility bg-surface-tertiary" />
      <div className="absolute top-44 left-10 h-20 w-96 rounded-utility bg-surface-tertiary" />
      <FramePins
        comments={[
          { id: "a", box: { x: 40, y: 64, w: 288, h: 48 }, author: "Ana", onSelect: () => {} },
          { id: "b", box: { x: 40, y: 64, w: 288, h: 48 }, author: "Bo", onSelect: () => {} },
        ]}
        cursor={{ box: { x: 40, y: 176, w: 384, h: 80 }, label: "Coder 🤖 · Website" }}
      />
    </div>
  ),
};

/** A new comment: the note is written beside the picked element. */
export const Draft: Story = {
  render: () => (
    <div className="relative h-80 w-[36rem] rounded-card border border-border bg-surface-secondary">
      <div className="absolute top-16 left-10 h-12 w-48 rounded-utility bg-surface-tertiary" />
      <FramePins
        comments={[]}
        draft={{
          box: { x: 40, y: 64, w: 192, h: 48 },
          form: <AnnotationForm target={TARGET} note="" onNoteChange={() => {}} onAdd={() => {}} onCancel={() => {}} />,
          onClose: () => {},
        }}
      />
    </div>
  ),
};
