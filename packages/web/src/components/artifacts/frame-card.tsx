import { useEffect, useRef } from "react";
import type { FrameInfo, FrameTransition } from "@/lib/artifacts/frames";
import { PREVIEW_SANDBOX, PreviewMessage } from "@/lib/artifacts/srcdoc";
import { cn } from "@/lib/utils";
import type { ActorKind } from "@/model/types";
import { ActorDot } from "./artifact-menus";

/**
 * One frame of a slides or design document, drawn small: the same srcdoc in another
 * sandboxed frame that takes no input (`inert`), laid out at its canvas size and scaled
 * down with a CSS transform into a 16:9 box. Not `live`, it shows the frame number.
 */
export function FrameThumb({
  srcdoc,
  channel,
  index,
  frame,
  width,
  live = true,
  transition,
}: {
  srcdoc: string;
  /** Baked into `srcdoc`. */
  channel: string;
  index: number;
  frame: Pick<FrameInfo, "width" | "height">;
  /** Box width in px. */
  width: number;
  live?: boolean;
  /** How a change of `index` enters (the presenter view's current slide). */
  transition?: FrameTransition;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const height = Math.round((width * 9) / 16);
  const scale = Math.min(width / frame.width, height / frame.height);
  const show = () => {
    ref.current?.contentWindow?.postMessage(
      { type: PreviewMessage.frame, channel, detail: { index, zoom: null, transition } },
      "*",
    );
  };
  useEffect(show, [index]);
  return (
    <div className="relative shrink-0 overflow-hidden rounded-utility bg-surface-secondary" style={{ width, height }}>
      {live ? (
        <iframe
          ref={ref}
          title={`Frame ${index + 1}`}
          inert
          tabIndex={-1}
          sandbox={PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={srcdoc}
          onLoad={show}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{
            width: frame.width,
            height: frame.height,
            transform: `translate(${(width - frame.width * scale) / 2}px, ${(height - frame.height * scale) / 2}px) scale(${scale})`,
          }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-caption1 text-text-tertiary tabular-nums">
          {index + 1}
        </span>
      )}
    </div>
  );
}

/**
 * A preview card: the thumb, the number and the name. The whole card selects the frame.
 * With edit rights it also holds the frame's menu (`menu`) and takes its keys; `changed`
 * marks a frame the shown version changed, in its author's actor color.
 */
export function FrameCard({
  srcdoc,
  channel,
  index,
  frame,
  width,
  live,
  active,
  onSelect,
  menu,
  changed,
  onKeyDown,
  onContextMenu,
}: {
  srcdoc: string;
  channel: string;
  index: number;
  frame: Pick<FrameInfo, "name" | "width" | "height" | "skip">;
  width: number;
  live: boolean;
  active: boolean;
  onSelect: () => void;
  menu?: React.ReactNode;
  changed?: ActorKind;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        "relative flex flex-col gap-1 rounded-card p-1.5 transition-colors",
        active ? "bg-surface-selected" : "hover:bg-surface-secondary",
      )}
    >
      <div className={cn("rounded-utility", active && "ring-2 ring-accent-brand", frame.skip && "opacity-40")}>
        <FrameThumb srcdoc={srcdoc} channel={channel} index={index} frame={frame} width={width} live={live} />
      </div>
      {/* Above the select button's ::after, so it takes its own clicks. */}
      {menu ? <div className="absolute top-2.5 right-2.5 z-10">{menu}</div> : null}
      {/* The button's ::after covers the card, so a click on the thumb selects too. */}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className="flex min-w-0 cursor-pointer items-baseline gap-2 text-left text-caption1 after:absolute after:inset-0 after:rounded-card"
      >
        <span className="shrink-0 text-text-tertiary tabular-nums">{index + 1}</span>
        <span className={cn("min-w-0 flex-1 truncate", active ? "text-text-primary" : "text-text-secondary")}>
          {frame.name}
        </span>
        {frame.skip ? <span className="shrink-0 text-text-tertiary">Skipped</span> : null}
        {changed ? (
          <>
            <ActorDot kind={changed} className="self-center" />
            <span className="sr-only">Changed</span>
          </>
        ) : null}
      </button>
    </div>
  );
}
