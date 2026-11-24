import { ArrowDownIcon, ArrowUpIcon, LoopIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { useFieldDraft } from "@/hooks/use-field-draft";
import { type MotionClock, useMotionTime } from "@/hooks/use-motion-clock";
import { DURATION, formatTime, type Scene, sceneStart, totalDuration } from "@/lib/artifacts/motion";
import { cn } from "@/lib/utils";

const seconds = (ms: number) => `${+(ms / 1000).toFixed(2)} s`;

/**
 * A motion artifact's transport (spec §6.11): play or pause, a scrubber with a mark where
 * each scene starts, the time, and loop. The scrubber is a native range: arrows step 0.1 s,
 * Page Up and Page Down a tenth; Space on it plays or pauses.
 */
export function MotionTransport({
  scenes,
  time,
  playing,
  loop,
  onPlay,
  onSeek,
  onLoop,
}: {
  scenes: readonly Scene[];
  /** ms on the global clock. */
  time: number;
  playing: boolean;
  loop: boolean;
  /** Toggles play and pause. */
  onPlay: () => void;
  onSeek: (ms: number) => void;
  onLoop: (loop: boolean) => void;
}) {
  const total = totalDuration(scenes);
  return (
    <div
      role="group"
      aria-label="Playback"
      data-testid="motion-transport"
      className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-1.5"
    >
      <IconButton size="small" icon={playing ? <PauseIcon /> : <PlayIcon />} label={playing ? "Pause" : "Play"} onClick={onPlay} />
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          type="range"
          aria-label="Time"
          aria-valuetext={`${formatTime(time)} of ${formatTime(total)}`}
          min={0}
          max={total}
          step={100}
          value={time}
          onChange={(e) => onSeek(e.target.valueAsNumber)}
          onKeyDown={(e) => {
            if (e.key !== " ") return;
            e.preventDefault();
            onPlay();
          }}
          className="w-full accent-accent-brand"
        />
        {/* Where scenes 2… start; the range's thumb is 16px, so the track runs from 8px to 100% − 8px. */}
        {total > 0
          ? scenes.slice(1).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-text-tertiary"
                style={{ left: `calc(8px + (100% - 16px) * ${sceneStart(scenes, i + 1) / total})` }}
              />
            ))
          : null}
      </div>
      <span data-testid="motion-time" className="shrink-0 text-caption1 text-text-secondary tabular-nums">
        {formatTime(time)} / {formatTime(total)}
      </span>
      <IconButton
        size="small"
        icon={<LoopIcon />}
        label="Loop"
        aria-pressed={loop}
        tone={loop ? "brand" : "default"}
        onClick={() => onLoop(!loop)}
      />
    </div>
  );
}

/** The transport on the live clock: only this re-renders on every tick. */
export function MotionBar({ clock, scenes }: { clock: MotionClock; scenes: readonly Scene[] }) {
  const time = useMotionTime(clock);
  return (
    <MotionTransport
      scenes={scenes}
      time={time}
      playing={clock.playing}
      loop={clock.loop}
      onPlay={clock.toggle}
      onSeek={clock.seek}
      onLoop={clock.setLoop}
    />
  );
}

/** A scene's duration in seconds; commits on Enter and blur. */
function DurationField({ label, value, onCommit }: { label: string; value: number; onCommit: (ms: number) => void }) {
  const field = useFieldDraft(String(value / 1000), (text) => text.trim() && onCommit(Math.round(Number(text) * 1000)), (a, b) => Number(a) === Number(b));
  return (
    <Input
      type="number"
      aria-label={label}
      min={DURATION.min / 1000}
      max={DURATION.max / 1000}
      step={0.1}
      value={field.text}
      onChange={(e) => field.change(e.target.value)}
      onBlur={field.commit}
      onKeyDown={(e) => e.key === "Enter" && field.commit()}
      className="h-7 w-16 px-2 py-0 text-caption1"
    />
  );
}

/**
 * The scenes of a motion artifact with their durations: a rail beside the stage, or with
 * `strip` (a phone) a row under it. Selecting one goes to its start. With `edit` (edit rights,
 * not on a phone) each scene's duration is a field and Move up / Move down reorder.
 */
export function MotionScenes({
  scenes,
  active,
  onSelect,
  edit,
  strip = false,
}: {
  scenes: readonly Scene[];
  active: number;
  onSelect: (index: number) => void;
  edit?: { onDuration: (index: number, ms: number) => void; onMove: (from: number, to: number) => void };
  strip?: boolean;
}) {
  if (strip)
    return (
      <nav aria-label="Scenes" data-testid="motion-scenes" className="shrink-0 overflow-x-auto border-t border-border px-2 py-1.5">
        <ol className="flex gap-1">
          {scenes.map((s, i) => (
            <li key={i} className="shrink-0">
              <button
                type="button"
                aria-current={i === active ? "true" : undefined}
                onClick={() => onSelect(i)}
                className={cn(
                  "rounded-pill px-2.5 py-1 text-caption1 whitespace-nowrap tabular-nums",
                  i === active ? "bg-surface-selected text-text-primary" : "text-text-secondary hover:bg-surface-secondary",
                )}
              >
                {i + 1} {s.name} · {seconds(s.duration)}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    );
  return (
    <nav aria-label="Scenes" data-testid="motion-scenes" className="w-44 shrink-0 overflow-y-auto border-r border-border p-2">
      <ol className="flex flex-col gap-1">
        {scenes.map((s, i) => (
          <li
            key={i}
            className={cn(
              "flex flex-col gap-1 rounded-card p-1.5 transition-colors",
              i === active ? "bg-surface-selected" : "hover:bg-surface-secondary",
            )}
          >
            <button
              type="button"
              aria-current={i === active ? "true" : undefined}
              onClick={() => onSelect(i)}
              className="flex min-w-0 cursor-pointer items-baseline gap-2 text-left text-caption1"
            >
              <span className="shrink-0 text-text-tertiary tabular-nums">{i + 1}</span>
              <span className={cn("min-w-0 flex-1 truncate", i === active ? "text-text-primary" : "text-text-secondary")}>
                {s.name}
              </span>
              {edit ? null : <span className="shrink-0 text-text-tertiary tabular-nums">{seconds(s.duration)}</span>}
            </button>
            {edit ? (
              <div className="flex items-center gap-1">
                <DurationField
                  label={`Duration of scene ${i + 1} in seconds`}
                  value={s.duration}
                  onCommit={(ms) => edit.onDuration(i, ms)}
                />
                <span className="flex-1 text-caption1 text-text-tertiary">s</span>
                <IconButton
                  size="small"
                  icon={<ArrowUpIcon />}
                  label={`Move scene ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => edit.onMove(i, i - 1)}
                />
                <IconButton
                  size="small"
                  icon={<ArrowDownIcon />}
                  label={`Move scene ${i + 1} down`}
                  disabled={i === scenes.length - 1}
                  onClick={() => edit.onMove(i, i + 1)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
