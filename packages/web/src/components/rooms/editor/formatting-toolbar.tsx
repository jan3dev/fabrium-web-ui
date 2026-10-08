// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/FormattingToolbar.tsx. Modified.
import * as React from "react";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
} from "@/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ActiveStates = Record<
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "codeBlock"
  | "link"
  | "bulletList"
  | "orderedList"
  | "blockquote",
  boolean
>;

function getActiveStates(editor: Editor): ActiveStates {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    codeBlock: editor.isActive("codeBlock"),
    link: editor.isActive("link"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    blockquote: editor.isActive("blockquote"),
  };
}

/** Ask for a URL and link the selection, or unlink the link under the caret. */
function toggleLink(editor: Editor) {
  if (editor.isActive("link")) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  const url = window.prompt("Link URL");
  if (!url) return;
  const { from, to } = editor.state.selection;
  if (from === to) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: url,
        marks: [{ type: "link", attrs: { href: url } }],
      })
      .run();
  } else {
    editor.chain().focus().setLink({ href: url }).run();
  }
}

/**
 * Formatting buttons for the composer. Plain buttons with explicit active
 * classes; the selection is captured on pointer-down so a click on a button
 * cannot collapse it first.
 */
export const FormattingToolbar = React.memo(function FormattingToolbar({
  editor,
  disabled = false,
}: {
  editor: Editor | null;
  disabled?: boolean;
}) {
  const pendingSelectionRef = React.useRef<{
    anchor: number;
    head: number;
  } | null>(null);
  const [active, setActive] = React.useState<ActiveStates | null>(() =>
    editor ? getActiveStates(editor) : null,
  );

  React.useEffect(() => {
    if (!editor) {
      setActive(null);
      return;
    }
    setActive(getActiveStates(editor));
    const onTransaction = () => setActive(getActiveStates(editor));
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const captureSelection = React.useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      pendingSelectionRef.current = null;
      return;
    }
    const { anchor, head } = editor.state.selection;
    pendingSelectionRef.current = { anchor, head };
  }, [editor]);

  /** A focused chain on the selection captured at pointer-down. */
  const chain = React.useCallback(() => {
    if (!editor) return null;
    const range = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    const c = editor.chain();
    const size = editor.state.doc.content.size;
    if (
      range &&
      range.anchor !== range.head &&
      range.anchor <= size &&
      range.head <= size
    ) {
      c.command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, range.anchor, range.head));
        return true;
      });
    }
    return c.focus();
  }, [editor]);

  if (!editor || !active) return null;

  const items = [
    {
      Icon: BoldIcon,
      label: "Bold",
      shortcut: "⌘B",
      active: active.bold,
      run: () => chain()?.toggleBold().run(),
    },
    {
      Icon: ItalicIcon,
      label: "Italic",
      shortcut: "⌘I",
      active: active.italic,
      run: () => chain()?.toggleItalic().run(),
    },
    {
      Icon: StrikethroughIcon,
      label: "Strikethrough",
      shortcut: "⌘⇧S",
      active: active.strike,
      run: () => chain()?.toggleStrike().run(),
    },
    {
      Icon: CodeIcon,
      label: "Code",
      shortcut: "⌘E",
      active: active.code,
      run: () => chain()?.toggleCode().run(),
    },
    {
      Icon: SquareCodeIcon,
      label: "Code block",
      active: active.codeBlock,
      run: () => chain()?.toggleCodeBlock().run(),
    },
    {
      Icon: LinkIcon,
      label: "Link",
      active: active.link,
      run: () => {
        chain()?.run();
        toggleLink(editor);
      },
    },
    {
      Icon: ListIcon,
      label: "Bullet list",
      active: active.bulletList,
      run: () => chain()?.toggleBulletList().run(),
    },
    {
      Icon: ListOrderedIcon,
      label: "Ordered list",
      active: active.orderedList,
      run: () => chain()?.toggleOrderedList().run(),
    },
    {
      Icon: QuoteIcon,
      label: "Quote",
      active: active.blockquote,
      run: () => chain()?.toggleBlockquote().run(),
    },
  ];

  return (
    <div className="flex items-center gap-0.5">
      {items.map(({ Icon, label, shortcut, active: on, run }) => (
        <Tooltip key={label} disableHoverableContent>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={on}
              disabled={disabled}
              onClick={run}
              onMouseDown={captureSelection}
              className={cn(
                "inline-flex size-7 min-w-7 items-center justify-center rounded-utility transition-colors",
                "hover:bg-surface-secondary hover:text-text-primary",
                "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
                "disabled:pointer-events-none disabled:opacity-50",
                "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
                on
                  ? "bg-surface-selected text-text-primary"
                  : "bg-transparent text-text-secondary",
              )}
            >
              <Icon />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {shortcut ? `${label} (${shortcut})` : label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
});
