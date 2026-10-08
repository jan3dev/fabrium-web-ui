// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/lib/useRichTextEditor.ts. Modified.
import * as React from "react";

import { Markdown as TiptapMarkdown } from "tiptap-markdown";
import { useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import {
  CodeBlockAfterHardBreak,
  handleCodeFenceEnter,
  insertNewlineInCodeBlock,
} from "./code-block-extensions";
import {
  MentionHighlightExtension,
  syncMentionHighlight,
  type MentionHighlightStorage,
} from "./mention-highlight-extension";
import { buildPlainTextProjection } from "./plain-text-projection";

export type RichTextEditorOptions = {
  placeholder?: string;
  ariaLabel?: string;
  /** Plain text and caret offset after every change, for autocomplete. */
  onUpdate?: (info: { text: string; cursor: number }) => void;
  editable?: boolean;
  /** Names drawn as chips: `@` humans and agents, `#` rooms. */
  highlight?: MentionHighlightStorage;
  /** Plain Enter. Runs before ProseMirror's splitBlock, so no stray paragraph. */
  onSubmit?: () => void;
  /** Files pasted from the clipboard. */
  onPasteFiles?: (files: File[]) => void;
};

/**
 * A TipTap editor that reads and writes Markdown. Enter submits, Shift+Enter
 * breaks the line (or continues a list or quote).
 */
export function useRichTextEditor({
  placeholder,
  ariaLabel = "Message",
  onUpdate,
  editable = true,
  highlight,
  onSubmit,
  onPasteFiles,
}: RichTextEditorOptions) {
  const onUpdateRef = React.useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onSubmitRef = React.useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onPasteFilesRef = React.useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  const placeholderRef = React.useRef(placeholder);
  placeholderRef.current = placeholder;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Shift+Enter is a hard break; Enter submits.
          hardBreak: { keepMarks: true },
          // "#" starts a room link here, not a heading.
          heading: false,
          code: { HTMLAttributes: { spellcheck: "false" } },
          codeBlock: { HTMLAttributes: { spellcheck: "false" } },
          // No forced empty paragraph after lists and code blocks.
          trailingNode: false,
          link: false,
        }),
        // Shift+Enter inside lists/blockquotes: split the node instead of
        // inserting a hard break so continuation lines keep their formatting.
        Extension.create({
          name: "smartShiftEnter",
          addKeyboardShortcuts() {
            // Exit a list by removing the empty last item and inserting a
            // paragraph after the list.
            const exitListIfEmptyLast = (ed: typeof this.editor): boolean => {
              if (!ed.isActive("listItem")) return false;
              const { $from } = ed.state.selection;
              let listItemDepth = -1;
              for (let d = $from.depth; d >= 1; d--) {
                if ($from.node(d).type.name === "listItem") {
                  listItemDepth = d;
                  break;
                }
              }
              if (listItemDepth < 1) return false;

              const listItem = $from.node(listItemDepth);
              const isEmpty =
                listItem.childCount === 1 &&
                listItem.firstChild?.textContent === "";
              if (!isEmpty) return false;

              const listDepth = listItemDepth - 1;
              const list = $from.node(listDepth);
              if ($from.index(listDepth) !== list.childCount - 1) return false;

              const { tr, schema } = ed.state;
              if (list.childCount === 1) {
                const listStart = $from.before(listDepth);
                tr.replaceWith(
                  listStart,
                  $from.after(listDepth),
                  schema.nodes.paragraph.create(),
                );
                tr.setSelection(
                  TextSelection.near(tr.doc.resolve(listStart + 1)),
                );
              } else {
                tr.delete(
                  $from.before(listItemDepth),
                  $from.after(listItemDepth),
                );
                const listEnd = tr.mapping.map($from.after(listDepth));
                tr.insert(listEnd, schema.nodes.paragraph.create());
                tr.setSelection(
                  TextSelection.near(tr.doc.resolve(listEnd + 1)),
                );
              }
              ed.view.dispatch(tr);
              return true;
            };

            return {
              "Shift-Enter": ({ editor: ed }) => {
                if (ed.isActive("codeBlock"))
                  return insertNewlineInCodeBlock(ed);
                if (exitListIfEmptyLast(ed)) return true;
                if (ed.isActive("listItem")) {
                  return ed.commands.splitListItem("listItem");
                }
                if (ed.isActive("blockquote")) {
                  const { $from } = ed.state.selection;
                  if ($from.parent.textContent === "") {
                    return ed.commands.lift("blockquote");
                  }
                  return ed.chain().splitBlock().focus().run();
                }
                return false;
              },
              ArrowDown: ({ editor: ed }) => exitListIfEmptyLast(ed),
            };
          },
        }),
        Extension.create({
          name: "submitOnEnter",
          addKeyboardShortcuts() {
            return {
              Enter: ({ editor: ed }) => {
                if (!onSubmitRef.current) return false;
                const fenceResult = handleCodeFenceEnter(ed);
                if (fenceResult !== undefined) return fenceResult;
                onSubmitRef.current();
                return true;
              },
            };
          },
        }),
        CodeBlockAfterHardBreak,
        MentionHighlightExtension,
        Placeholder.configure({
          placeholder: () => placeholderRef.current ?? "Write a message…",
          // A disabled composer still says why ("Pick a room first").
          showOnlyWhenEditable: false,
        }),
        Link.extend({
          inclusive() {
            return false;
          },
        }).configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            class: "text-accent-brand underline underline-offset-4 cursor-text",
          },
        }),
        TiptapMarkdown.configure({
          html: false,
          transformPastedText: true,
          transformCopiedText: true,
          breaks: true,
        }),
      ],
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaLabel,
          autocapitalize: "none",
          autocorrect: "off",
          class:
            "markdown composer-editor min-h-6 max-w-none bg-transparent text-body2 text-text-primary caret-text-primary outline-none",
          "data-testid": "message-input",
          spellcheck: "true",
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0 || !onPasteFilesRef.current) return false;
          onPasteFilesRef.current(files);
          return true;
        },
        // Dropped files are the composer's attachments, not document content.
        handleDrop: (_view, event) => (event.dataTransfer?.files.length ?? 0) > 0,
        handleKeyDown: (view, event) => {
          // ⌘⇧V / Ctrl+Shift+V: paste the clipboard's plain text, through
          // ProseMirror's paste pipeline so the plain-text handlers still run.
          if (
            event.key.toLowerCase() === "v" &&
            (event.metaKey || event.ctrlKey) &&
            event.shiftKey &&
            !event.altKey &&
            !event.repeat &&
            !event.isComposing
          ) {
            event.preventDefault();
            void navigator.clipboard
              ?.readText()
              .then((text) => {
                const clipboardData = new DataTransfer();
                clipboardData.setData("text/plain", text);
                view.pasteText(
                  text,
                  new ClipboardEvent("paste", { clipboardData }),
                );
              })
              .catch(() => {
                // The key is consumed; a late native paste could duplicate text.
              });
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        const projection = buildPlainTextProjection(ed.state.doc);
        onUpdateRef.current?.({
          text: projection.text,
          cursor: projection.mapPMToTextOffset(ed.state.selection.anchor),
        });
      },
    },
    [],
  );

  // Toggle editable without recreating the editor. Disabling blurs it; take
  // focus back when it is re-enabled, if this editor had it.
  const hadFocusBeforeDisableRef = React.useRef(false);
  React.useEffect(() => {
    if (!editor || editor.isEditable === editable) return;
    if (!editable) {
      hadFocusBeforeDisableRef.current = editor.isFocused;
      editor.setEditable(false, false);
    } else {
      editor.setEditable(true, false);
      if (hadFocusBeforeDisableRef.current) {
        hadFocusBeforeDisableRef.current = false;
        editor.commands.focus();
      }
    }
  }, [editor, editable]);

  // Redraw the placeholder decoration when its text changes.
  React.useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  React.useEffect(() => {
    if (editor && highlight) syncMentionHighlight(editor, highlight);
  }, [editor, highlight]);

  const getMarkdown = React.useCallback(
    (): string => (editor ? getMarkdownFromEditor(editor) : ""),
    [editor],
  );

  const clearContent = React.useCallback(() => {
    editor?.commands.clearContent(true);
  }, [editor]);

  const focus = React.useCallback(() => {
    editor?.commands.focus("end");
  }, [editor]);

  /** Plain text and the caret's offset in it; see `buildPlainTextProjection`. */
  const getPlainTextAndCursor = React.useCallback((): {
    text: string;
    cursor: number;
  } => {
    if (!editor) return { text: "", cursor: 0 };
    const projection = buildPlainTextProjection(editor.state.doc);
    return {
      text: projection.text,
      cursor: projection.mapPMToTextOffset(editor.state.selection.anchor),
    };
  }, [editor]);

  /**
   * Replace a plain-text range with literal text in one transaction, keeping
   * marks, list structure and undo history, and put the caret after it.
   */
  const replacePlainTextRange = React.useCallback(
    (fromOffset: number, toOffset: number, text: string) => {
      if (!editor) return;
      const projection = buildPlainTextProjection(editor.state.doc);
      const fromPM = projection.mapTextOffsetToPM(fromOffset);
      const toPM = projection.mapTextOffsetToPM(toOffset);
      const tr = editor.state.tr.insertText(text, fromPM, toPM);
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(toPM)));
      editor.view.dispatch(tr);
      editor.view.focus();
    },
    [editor],
  );

  return {
    editor,
    getMarkdown,
    clearContent,
    focus,
    getPlainTextAndCursor,
    replacePlainTextRange,
  };
}

export type UseRichTextEditorResult = ReturnType<typeof useRichTextEditor>;

function getMarkdownFromEditor(editor: Editor): string {
  const storage = (
    editor.storage as unknown as {
      markdown?: { getMarkdown?: () => string };
    }
  ).markdown;
  if (!storage?.getMarkdown) return editor.state.doc.textContent;
  return (
    storage
      .getMarkdown()
      // Hard breaks serialize as "\" + newline; a plain newline renders the same.
      .replace(/\\\n/g, "\n")
      // Keep the characters the user typed: prosemirror-markdown escapes
      // ` * \ ~ [ ] _ in text, but messages are rendered as Markdown anyway.
      .replace(/\\([`*\\~[\]_])/g, "$1")
  );
}
