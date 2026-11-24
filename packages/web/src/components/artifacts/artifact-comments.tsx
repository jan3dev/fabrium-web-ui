import { type ReactNode, useState } from "react";
import { CheckIcon, CommentIcon, SelectIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { Box } from "@/lib/artifacts/canvas";
import type { ArtifactComment } from "@/lib/artifacts/comments";
import { describeTarget } from "./artifact-refs";

/** A marker for an open comment, at its element's box in the stage. */
export interface CommentPin {
  id: string;
  box: Box;
  author: string;
  onSelect: () => void;
}

const MARKER_STEP = 24;
/** Height the cursor label needs above its box. */
const LABEL_ROOM = 28;

/**
 * Over the frame, in the stage's coordinates (spec §6.6, §6.8): a marker per open comment with
 * its author, the agent cursor on the element it works on, and the note form for a new comment
 * in a popover beside its element. Comments on one element stack.
 */
export function FramePins({
  comments,
  cursor,
  draft,
}: {
  comments: readonly CommentPin[];
  /** `label`: the agent, "Name · Project". */
  cursor?: { box: Box; label: string } | null;
  /** A comment being written on the element at `box`. Escape closes it; a click elsewhere does not. */
  draft?: { box: Box; form: ReactNode; onClose: () => void } | null;
}) {
  const stacked = new Map<string, number>();
  // The popover keeps to the frame while it fits, so it does not cover the side panel.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setFrame} className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
      {cursor ? (
        <div
          data-testid="agent-cursor"
          className="absolute rounded-utility ring-2 ring-actor-agent transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
          style={{ left: cursor.box.x, top: cursor.box.y, width: cursor.box.w, height: cursor.box.h }}
        >
          <span
            role="status"
            className={`absolute left-0 flex max-w-64 ${
              // Above the box, or below it when the box is at the stage's top edge.
              cursor.box.y < LABEL_ROOM ? "top-full mt-1" : "top-0 -translate-y-[calc(100%+4px)]"
            } items-center gap-1 rounded-pill border border-actor-agent bg-surface-primary px-2 py-0.5 text-caption1 font-medium whitespace-nowrap text-actor-agent shadow-button`}
          >
            <SelectIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{cursor.label}</span>
          </span>
        </div>
      ) : null}
      {draft ? (
        <Popover open onOpenChange={(open) => !open && draft.onClose()}>
          <PopoverAnchor asChild>
            <div
              className="absolute"
              style={{ left: draft.box.x, top: draft.box.y, width: draft.box.w, height: draft.box.h }}
            />
          </PopoverAnchor>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            collisionBoundary={frame}
            // Gone with its element when that scrolls out of the frame.
            hideWhenDetached
            aria-label="New comment"
            data-testid="comment-popover"
            // The frame and the style controls stay usable while the note is open.
            onInteractOutside={(e) => e.preventDefault()}
          >
            {draft.form}
          </PopoverContent>
        </Popover>
      ) : null}
      {comments.map((c) => {
        const key = `${Math.round(c.box.x)},${Math.round(c.box.y)}`;
        const n = stacked.get(key) ?? 0;
        stacked.set(key, n + 1);
        return (
          <button
            key={c.id}
            type="button"
            data-testid="comment-marker"
            aria-label={`Comment by ${c.author}. Show it in the thread`}
            onClick={c.onSelect}
            className="pointer-events-auto absolute flex max-w-48 items-center gap-1 rounded-pill border border-border bg-surface-primary px-2 py-0.5 text-caption1 font-medium text-text-primary shadow-button hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            style={{ left: Math.max(4, c.box.x), top: Math.max(4, c.box.y - 12) + n * MARKER_STEP }}
          >
            <CommentIcon className="size-3 shrink-0 text-text-tertiary" aria-hidden />
            <span className="truncate">{c.author}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The side panel's Comments tab: the open ones, oldest first. Only humans resolve (`onResolve`). */
export function CommentList({
  comments,
  onShow,
  onResolve,
}: {
  comments: readonly ArtifactComment[];
  onShow: (comment: ArtifactComment) => void;
  onResolve?: (comment: ArtifactComment) => void;
}) {
  if (comments.length === 0) return <p className="text-caption1 text-text-tertiary">No open comments.</p>;
  return (
    <ul aria-label="Open comments" className="flex flex-col gap-1">
      {comments.map((c) => (
        <li key={c.id} className="flex flex-col gap-1.5 rounded-utility bg-surface-secondary px-2.5 py-1.5">
          <button type="button" onClick={() => onShow(c)} className="min-w-0 cursor-pointer text-left">
            <span className="block truncate text-caption1 text-text-secondary">
              <span className="font-semibold text-text-primary">{c.author.displayName}</span> · v{c.ref.version} ·{" "}
              <span className="font-mono">{describeTarget(c.ref.target)}</span>
            </span>
            {c.ref.note.trim() || c.text.trim() ? (
              <span className="line-clamp-2 block text-caption1 whitespace-pre-wrap text-text-primary">
                {c.ref.note.trim() || c.text}
              </span>
            ) : null}
          </button>
          {onResolve ? (
            <Button size="xs" variant="utility" className="self-end" onClick={() => onResolve(c)}>
              <CheckIcon />
              Resolve
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
