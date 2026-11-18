import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, GridIcon, PlusIcon, PresentIcon, SingleFrameIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { type FrameInfo, type FrameKind, ZOOMS as ZOOM_LEVELS } from "@/lib/artifacts/frames";
import { cn } from "@/lib/utils";
import type { ActorKind } from "@/model/types";
import { type FrameAction, FrameMenu, frameUnit } from "./artifact-menus";
import { FrameCard } from "./frame-card";

/** Drag data type of a card being moved; other drops are ignored. */
const DRAG_TYPE = "application/x-fabrium-frame";

/** The rail's edit controls, for users who may write a version. */
export interface FrameRailEdit {
  kind: FrameKind;
  onAction: (index: number, action: FrameAction) => void;
  /** A card dragged from `from` and dropped on `to`. */
  onMove: (from: number, to: number) => void;
}

/** Live preview frames at once; the other cards show their number (§5.5). */
const MAX_LIVE = 12;

/**
 * The frames of a slides or design artifact as preview cards. A rail beside the stage,
 * or with `grid` the same cards larger in the stage. Selecting one shows it.
 */
export function FrameRail({
  label,
  frames,
  srcdoc,
  channel,
  active,
  onSelect,
  grid = false,
  edit,
  changed,
}: {
  /** "Slides" or "Screens". */
  label: string;
  frames: readonly FrameInfo[];
  /** The frame document the cards render, and the channel baked into it. */
  srcdoc: string;
  channel: string;
  active: number;
  onSelect: (index: number) => void;
  grid?: boolean;
  edit?: FrameRailEdit;
  /** Frames the shown version changed, marked in its author's actor color. */
  changed?: { indexes: readonly number[]; actor: ActorKind };
}) {
  const ref = useRef<HTMLElement>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [live, setLive] = useState<ReadonlySet<number>>(() => new Set());
  // Keys move the active frame from elsewhere: keep it in view.
  useEffect(() => {
    ref.current?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Only cards in view get a frame, the first MAX_LIVE of them.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index);
          if (e.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
        const next = [...visible].sort((a, b) => a - b).slice(0, MAX_LIVE);
        // Scrolling fires often: keep the same set while the live cards stay the same.
        setLive((prev) => (prev.size === next.length && next.every((i) => prev.has(i)) ? prev : new Set(next)));
      },
      { root },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [frames.length, grid]);
  return (
    <nav
      ref={ref}
      aria-label={label}
      data-testid={grid ? "frame-grid" : "frame-rail"}
      // The grid leaves room for the panel's floating toolbar.
      className={cn("overflow-y-auto", grid ? "h-full p-4 pt-14" : "w-44 shrink-0 border-r border-border p-2")}
    >
      <ol className={grid ? "grid grid-cols-[repeat(auto-fill,15.5rem)] gap-3" : "flex flex-col gap-1"}>
        {frames.map((frame, i) => (
          <li
            key={i}
            data-index={i}
            draggable={!!edit}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, String(i));
              e.dataTransfer.effectAllowed = "move";
              setDrag({ from: i, over: i });
            }}
            onDragOver={(e) => {
              if (!drag || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              if (drag.over !== i) setDrag({ ...drag, over: i });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drag.from !== i) edit?.onMove(drag.from, i);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={cn("rounded-card", drag && drag.over === i && drag.from !== i && "ring-2 ring-accent-brand")}
          >
            <FrameCard
              srcdoc={srcdoc}
              channel={channel}
              index={i}
              frame={frame}
              width={grid ? 236 : 148}
              live={live.has(i)}
              active={i === active}
              onSelect={() => onSelect(i)}
              changed={changed?.indexes.includes(i) ? changed.actor : undefined}
              menu={
                edit ? (
                  <FrameMenu
                    kind={edit.kind}
                    index={i}
                    count={frames.length}
                    skip={frame.skip}
                    open={menuFor === i}
                    onOpenChange={(open) => setMenuFor(open ? i : null)}
                    onAction={(action) => edit.onAction(i, action)}
                  />
                ) : undefined
              }
              onContextMenu={
                edit
                  ? (e) => {
                      e.preventDefault();
                      setMenuFor(i);
                    }
                  : undefined
              }
              onKeyDown={
                edit
                  ? (e) => {
                      const del = e.key === "Delete" || e.key === "Backspace";
                      const dup = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d";
                      if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") setMenuFor(i);
                      else if (del && frames.length > 1) edit.onAction(i, { type: "delete" });
                      else if (dup) edit.onAction(i, { type: "duplicate" });
                      else if (!del) return;
                      e.preventDefault();
                      e.stopPropagation();
                      // The card may be gone or moved: keep the keyboard on the open one.
                      if (del || dup)
                        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[aria-current]")?.focus());
                    }
                  : undefined
              }
            />
          </li>
        ))}
      </ol>
      {edit ? (
        <Button
          size="xs"
          variant="utility"
          className={cn("mt-2", grid ? "" : "w-full")}
          onClick={() => edit.onAction(active, { type: "add" })}
        >
          <PlusIcon />
          Add {frameUnit(edit.kind)}
        </Button>
      ) : null}
    </nav>
  );
}

const ZOOMS = [
  { value: "fit", label: "Fit" },
  ...ZOOM_LEVELS.map((z) => ({ value: String(z), label: `${z * 100}%` })),
];

/** Present from the open slide, from the first, or with the presenter view. */
export type PresentMode = "current" | "start" | "notes";

/**
 * The frame part of the panel's toolbar: zoom, the grid toggle and the Present menu
 * when their handlers are given. While presenting, Present becomes End.
 */
export function FrameControls({
  zoom = null,
  onZoom,
  grid = false,
  onGrid,
  onPresent,
  notes = false,
  presenting = false,
  onEnd,
}: {
  /** null fits the frame to the stage. */
  zoom?: number | null;
  onZoom?: (zoom: number | null) => void;
  grid?: boolean;
  onGrid?: (grid: boolean) => void;
  onPresent?: (mode: PresentMode) => void;
  /** The deck has speaker notes: offer the presenter view. */
  notes?: boolean;
  presenting?: boolean;
  onEnd?: () => void;
}) {
  const zoomValue = zoom === null ? "fit" : String(zoom);
  const zoomLabel = ZOOMS.find((z) => z.value === zoomValue)?.label ?? `${Math.round((zoom ?? 1) * 100)}%`;
  return (
    <>
      {onZoom && !grid ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="utility" data-testid="frame-zoom" aria-label={`Zoom: ${zoomLabel}`}>
              {zoomLabel}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={zoomValue} onValueChange={(v) => onZoom(v === "fit" ? null : Number(v))}>
              {ZOOMS.map((z) => (
                <DropdownMenuRadioItem key={z.value} value={z.value}>
                  {z.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {onGrid ? (
        <IconButton
          size="small"
          // One slot: the button shows the view it switches to.
          icon={grid ? <SingleFrameIcon /> : <GridIcon />}
          label={grid ? "Single view" : "Grid view"}
          onClick={() => onGrid(!grid)}
        />
      ) : null}
      {presenting ? (
        <Button size="xs" variant="utility" onClick={onEnd}>
          End presentation
        </Button>
      ) : onPresent ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton size="small" icon={<PresentIcon />} label="Present" />
          </DropdownMenuTrigger>
          {/* Present moves focus to the stage; the menu must not take it back. */}
          <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => onPresent("current")}>Present</DropdownMenuItem>
            {notes ? (
              <DropdownMenuItem onSelect={() => onPresent("notes")}>Present with speaker notes</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onPresent("start")}>Present from the start</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
