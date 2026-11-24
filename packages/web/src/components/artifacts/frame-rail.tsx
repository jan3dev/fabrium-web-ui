import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, GridIcon, PresentIcon, SingleFrameIcon } from "@/components/icons";
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
import { type FrameInfo, ZOOMS as ZOOM_LEVELS } from "@/lib/artifacts/frames";
import { cn } from "@/lib/utils";
import { FrameCard } from "./frame-card";

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
}) {
  const ref = useRef<HTMLElement>(null);
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
          <li key={i} data-index={i}>
            <FrameCard
              srcdoc={srcdoc}
              channel={channel}
              index={i}
              frame={frame}
              width={grid ? 236 : 148}
              live={live.has(i)}
              active={i === active}
              onSelect={() => onSelect(i)}
            />
          </li>
        ))}
      </ol>
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
