import { useId, useRef, useState } from "react";
import { DrawIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Box } from "@/lib/artifacts/canvas";
import type { Point } from "@/lib/artifacts/refs";

/** Enough for a few seconds of drawing; the rest of a long stroke is dropped. */
const MAX_POINTS = 1000;

const toPath = (points: readonly Point[]) => points.map((p) => `${p[0]},${p[1]}`).join(" ");

/**
 * Draw in comment mode (spec §3.8): markups over the active slide or artboard, drawn by the app
 * over the stage, never in the frame. While `drawing`, a layer over the whole stage takes the
 * pointer, so the frame gets none, and each stroke goes to `onStroke` in the frame's own pixels.
 * `marks` are the queued markups and the one being noted, in the same pixels.
 */
export function SketchOverlay({
  box,
  width,
  height,
  marks,
  drawing,
  onStroke,
}: {
  /** The frame's box on the stage; nothing shows until it is known. */
  box: Box | undefined;
  width: number;
  height: number;
  marks: readonly (readonly Point[])[];
  drawing: boolean;
  onStroke: (points: Point[]) => void;
}) {
  const [live, setLive] = useState<Point[] | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent): Point | null => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || !box || box.w <= 0 || box.h <= 0) return null;
    return [((e.clientX - r.left - box.x) * width) / box.w, ((e.clientY - r.top - box.y) * height) / box.h];
  };
  const lines = live ? [...marks, live] : marks;
  return (
    <>
      {box && (drawing || lines.length > 0) ? (
        <svg
          aria-hidden
          data-testid="sketch-marks"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute z-[6] overflow-visible"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        >
          {lines.map((points, i) => (
            <polyline
              key={i}
              points={toPath(points)}
              vectorEffect="non-scaling-stroke"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="fill-none stroke-accent-brand"
            />
          ))}
        </svg>
      ) : null}
      {drawing ? (
        <div
          ref={layer}
          data-testid="sketch-layer"
          className="absolute inset-0 z-[7] cursor-crosshair touch-none"
          onPointerDown={(e) => {
            const p = at(e);
            if (!p || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setLive([p]);
          }}
          onPointerMove={(e) => {
            const p = live && live.length < MAX_POINTS ? at(e) : null;
            if (p) setLive([...live!, p]);
          }}
          onPointerUp={() => {
            if (live) onStroke(live);
            setLive(null);
          }}
          onPointerCancel={() => setLive(null)}
        />
      ) : null}
    </>
  );
}

/** The Draw toggle beside the comment controls. Pointer only; the description says so. */
export function DrawToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const hint = useId();
  return (
    <>
      <Button
        size="xs"
        variant={on ? "secondary" : "utility"}
        aria-pressed={on}
        aria-describedby={hint}
        onClick={() => onChange(!on)}
      >
        <DrawIcon />
        Draw
      </Button>
      <span id={hint} className="sr-only">
        Pointer only: drag on the canvas to mark an area. With a keyboard, comment on an element instead.
      </span>
    </>
  );
}
