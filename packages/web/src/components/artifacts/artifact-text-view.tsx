import DOMPurify from "dompurify";
import { Marked } from "marked";
import { useMemo, useRef } from "react";
import { FormattedMessageBody } from "@/components/timeline/formatted-message-body";
import { MAX_REF_SNIPPET, type ArtifactRefTarget } from "@/lib/artifacts/refs";
import { cn } from "@/lib/utils";

const markdown = new Marked({ gfm: true });
const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,table";
const PICKED = "data-fab-picked";

type TextTarget = Extract<ArtifactRefTarget, { kind: "text" }>;

function clip(s: string): string {
  return s.trim().slice(0, MAX_REF_SNIPPET);
}

/** The nearest heading at or before `el` inside `root`: the section a passage sits in. */
function sectionOf(root: HTMLElement, el: Element): string | undefined {
  let found: string | undefined;
  for (const h of root.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    if (
      h === el ||
      h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      found = h.textContent?.trim() || found;
    }
  }
  return found ? `section "${found.slice(0, 120)}"` : undefined;
}

function lineOf(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const line = el?.closest<HTMLElement>("[data-line]")?.dataset.line;
  return line ? Number(line) : null;
}

/**
 * A markdown document or source code, rendered in the page (not the frame):
 * it is not executed, and it should follow the theme. While annotating, a
 * text selection or a click on a block (markdown) or line (code) is reported.
 */
export function ArtifactTextView({
  kind,
  text,
  roomId,
  annotating,
  onPicked,
}: {
  kind: "markdown" | "code";
  text: string;
  roomId: string;
  annotating: boolean;
  onPicked: (target: TextTarget) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () =>
      kind === "markdown"
        ? // No images: a remote src would load from the app's origin.
        DOMPurify.sanitize(markdown.parse(text, { async: false }), { FORBID_TAGS: ["img"] })
        : "",
    [kind, text],
  );
  const lines = useMemo(
    () => (kind === "code" ? text.replace(/\n$/, "").split("\n") : []),
    [kind, text],
  );

  function markPicked(el: Element | null) {
    rootRef.current
      ?.querySelectorAll(`[${PICKED}]`)
      .forEach((n) => n.removeAttribute(PICKED));
    el?.setAttribute(PICKED, "");
  }

  function onMouseUp(e: React.MouseEvent) {
    const root = rootRef.current;
    if (!annotating || !root) return;
    const sel = window.getSelection();
    const selected =
      sel && !sel.isCollapsed && root.contains(sel.anchorNode)
        ? clip(sel.toString())
        : "";
    if (kind === "code") {
      const a = lineOf(selected ? sel!.anchorNode : (e.target as Node));
      const b = selected ? lineOf(sel!.focusNode) : a;
      if (a === null || b === null) return;
      const [from, to] = a <= b ? [a, b] : [b, a];
      markPicked(selected ? null : root.querySelector(`[data-line="${from}"]`));
      onPicked({
        kind: "text",
        text: selected || clip(lines.slice(from - 1, to).join("\n")),
        where: from === to ? `line ${from}` : `lines ${from}-${to}`,
      });
      return;
    }
    const block = selected
      ? (sel!.anchorNode instanceof Element
          ? sel!.anchorNode
          : sel!.anchorNode?.parentElement
        )?.closest(BLOCKS)
      : (e.target as Element).closest(BLOCKS);
    if (!block || !root.contains(block)) return;
    markPicked(selected ? null : block);
    const where = sectionOf(root, block);
    const target: TextTarget = {
      kind: "text",
      text: selected || clip(block.textContent ?? ""),
    };
    if (where) target.where = where;
    if (target.text) onPicked(target);
  }

  return (
    <div
      ref={rootRef}
      data-testid={`artifact-${kind}`}
      onMouseUp={onMouseUp}
      className={cn(
        // Paint containment keeps `position: fixed` agent markup inside the view.
        "h-full overflow-auto bg-background contain-paint",
        "[&_[data-fab-picked]]:rounded-utility [&_[data-fab-picked]]:outline-2 [&_[data-fab-picked]]:outline-offset-2 [&_[data-fab-picked]]:outline-accent-brand",
        annotating && "cursor-crosshair",
      )}
    >
      {kind === "markdown" ? (
        <div className="mx-auto max-w-3xl px-6 py-6">
          <FormattedMessageBody html={html} roomId={roomId} />
        </div>
      ) : (
        <pre className="min-w-max py-3 font-mono text-caption1 leading-relaxed text-text-primary">
          {lines.map((line, i) => (
            <div
              key={i}
              data-line={i + 1}
              className="flex px-3 hover:bg-surface-secondary"
            >
              <span className="w-10 shrink-0 pr-3 text-right text-text-tertiary select-none">
                {i + 1}
              </span>
              <span className="whitespace-pre">{line || " "}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
