// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/SelectionFormattingTray.tsx. Modified.
import * as React from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";

import { cn } from "@/lib/utils";
import { FormattingToolbar } from "./formatting-toolbar";

type TrayPosition = {
  left: number;
  placement: "top" | "bottom";
  top: number;
};

const EDGE_GUTTER = 12;
const SELECTION_OFFSET = 8;
const MIN_SPACE_ABOVE = 44;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getTrayPosition(
  editor: Editor,
  trayWidth: number,
): TrayPosition | null {
  const { selection, doc } = editor.state;
  if (selection.empty) return null;
  if (
    doc.textBetween(selection.from, selection.to, "\n", "\n").trim().length ===
    0
  ) {
    return null;
  }

  const start = editor.view.coordsAtPos(selection.from);
  const end = editor.view.coordsAtPos(selection.to);
  const left = Math.min(start.left, end.left);
  const right = Math.max(start.right, end.right);
  const top = Math.min(start.top, end.top);
  const bottom = Math.max(start.bottom, end.bottom);

  const half = trayWidth / 2;
  const minLeft = Math.min(window.innerWidth - EDGE_GUTTER, EDGE_GUTTER + half);
  const maxLeft = Math.max(EDGE_GUTTER, window.innerWidth - EDGE_GUTTER - half);
  const center = clamp((left + right) / 2, minLeft, maxLeft);

  return top >= MIN_SPACE_ABOVE
    ? {
        left: center,
        placement: "top",
        top: Math.max(EDGE_GUTTER, top - SELECTION_OFFSET),
      }
    : {
        left: center,
        placement: "bottom",
        top: Math.min(
          window.innerHeight - EDGE_GUTTER,
          bottom + SELECTION_OFFSET,
        ),
      };
}

/** Formatting buttons floating over a text selection in the composer. */
export function SelectionFormattingTray({
  editor,
  disabled = false,
}: {
  editor: Editor | null;
  disabled?: boolean;
}) {
  const [position, setPosition] = React.useState<TrayPosition | null>(null);
  const [trayWidth, setTrayWidth] = React.useState(0);
  const trayRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setPosition(
          !disabled && editor.isEditable && editor.isFocused
            ? getTrayPosition(editor, trayWidth)
            : null,
        );
      });
    };
    const hide = () => setPosition(null);
    editor.on("selectionUpdate", update);
    editor.on("focus", update);
    editor.on("blur", hide);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      editor.off("selectionUpdate", update);
      editor.off("focus", update);
      editor.off("blur", hide);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [disabled, editor, trayWidth]);

  React.useLayoutEffect(() => {
    if (!position || !trayRef.current) return;
    const width = trayRef.current.getBoundingClientRect().width;
    setTrayWidth((current) =>
      Math.abs(current - width) > 1 ? width : current,
    );
  }, [position]);

  if (!position) return null;

  return createPortal(
    <div
      ref={trayRef}
      role="toolbar"
      aria-label="Selection formatting"
      className={cn(
        "fixed z-50 max-w-[calc(100vw-1.5rem)] rounded-card border border-border bg-popover p-1 text-popover-foreground shadow-modal",
        position.placement === "top"
          ? "-translate-x-1/2 -translate-y-full"
          : "-translate-x-1/2",
      )}
      data-testid="selection-formatting-tray"
      onMouseDown={(event) => event.preventDefault()}
      style={{ left: position.left, top: position.top }}
    >
      <div className="max-w-full overflow-x-auto">
        <FormattingToolbar disabled={disabled} editor={editor} />
      </div>
    </div>,
    document.body,
  );
}
