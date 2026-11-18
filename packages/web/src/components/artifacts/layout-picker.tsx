import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FRAME_SIZE } from "@/lib/artifacts/frames";
import type { SlideLayout } from "@/lib/artifacts/edit";
import { FrameThumb } from "./frame-card";

const SLIDE = { width: FRAME_SIZE.slides[0], height: FRAME_SIZE.slides[1] };

/**
 * Add slide (spec §6.2): the layouts to choose from, each a live preview in the deck's
 * design. `srcdoc` is the deck with the candidates as its only frames, in `layouts`
 * order; each preview is the same sandboxed, inert frame as a rail card, showing one.
 * Arrow keys move between the choices, Enter or a click picks one.
 */
export function LayoutPicker({
  open,
  layouts,
  srcdoc,
  channel,
  onPick,
  onOpenChange,
}: {
  open: boolean;
  layouts: readonly { name: SlideLayout; label: string }[];
  srcdoc: string;
  /** Baked into `srcdoc`. */
  channel: string;
  onPick: (layout: SlideLayout) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  function move(e: React.KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(grid.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    // Columns as laid out: the buttons on the first one's row.
    const top = (b: HTMLElement) => Math.round(b.getBoundingClientRect().top);
    const cols = buttons.filter((b) => top(b) === top(buttons[0]!)).length || 1;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, i + step))]?.focus();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add slide</DialogTitle>
          <DialogDescription>Choose a layout. The slide goes after the open one.</DialogDescription>
        </DialogHeader>
        <div
          ref={grid}
          role="group"
          aria-label="Layouts"
          onKeyDown={move}
          className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-5"
        >
          {layouts.map((l, i) => (
            // The thumb sits outside the button (a frame inside a button is nested interactive
            // content); the button's ::after covers the card, so a click on the thumb picks too.
            <div
              key={l.name}
              className="relative flex flex-col gap-1.5 rounded-card p-1.5 hover:bg-surface-secondary has-[button:focus-visible]:bg-surface-selected has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-accent-brand"
            >
              <span className="rounded-utility ring-1 ring-border">
                <FrameThumb srcdoc={srcdoc} channel={channel} index={i} frame={SLIDE} width={128} />
              </span>
              <button
                type="button"
                autoFocus={i === 0}
                data-layout={l.name}
                onClick={() => {
                  onPick(l.name);
                  onOpenChange(false);
                }}
                className="cursor-pointer text-left text-caption1 text-text-secondary outline-none after:absolute after:inset-0 after:rounded-card focus-visible:text-text-primary"
              >
                {l.label}
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
