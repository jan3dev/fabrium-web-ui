import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  type FrameInfo,
  type PresenterMessage,
  presenterChannel,
  readFrames,
  stepFrame,
} from "@/lib/artifacts/frames";
import { buildArtifactSrcdoc } from "@/lib/artifacts/srcdoc";
import { FrameThumb } from "./frame-card";

/**
 * The presenter window (`/present/:session`), opened by "Present with speaker notes".
 * The panel that opened it sends the deck it shows (same artifact, same version) over a
 * same-origin BroadcastChannel and follows the `go` messages sent back. Slides render
 * in sandboxed frames, as in the panel.
 */
export function PresenterView() {
  const { session = "" } = useParams();
  const [deck, setDeck] = useState<{ title: string; text: string; index: number } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const [frameChannel] = useState(() => `artifact_${crypto.randomUUID()}`);
  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ch = new BroadcastChannel(presenterChannel(session));
    ch.onmessage = (e: MessageEvent<unknown>) => {
      const d = e.data as Record<string, unknown> | null;
      if (d?.type === "end") window.close();
      else if (d?.type === "go" && typeof d.index === "number") {
        const index = d.index;
        setDeck((prev) => prev && { ...prev, index });
      } else if (
        d?.type === "deck" &&
        typeof d.title === "string" &&
        typeof d.text === "string" &&
        typeof d.index === "number"
      )
        setDeck({ title: d.title, text: d.text, index: d.index });
    };
    ch.postMessage({ type: "hello" } satisfies PresenterMessage);
    channel.current = ch;
    return () => ch.close();
  }, [session]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const text = deck?.text ?? null;
  const frames = useMemo(() => (text === null ? [] : readFrames("slides", text)), [text]);
  const srcdoc = useMemo(
    () => (text === null ? null : buildArtifactSrcdoc("slides", text, frameChannel)),
    [text, frameChannel],
  );
  const index = Math.max(0, Math.min(deck?.index ?? 0, frames.length - 1));
  const go = (i: number) => channel.current?.postMessage({ type: "go", index: i } satisfies PresenterMessage);

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = stepFrame(e.key, index, frames, true);
    if (next === null) return;
    e.preventDefault();
    if (next !== index) go(next);
  };
  useEffect(() => {
    const handle = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  useEffect(() => {
    document.title = deck ? `Presenter view · ${deck.title}` : "Presenter view";
  }, [deck?.title]);

  if (!deck || srcdoc === null || frames.length === 0) {
    return (
      <main className="flex h-svh items-center justify-center bg-background p-4 text-body2 text-text-secondary">
        Waiting for the presentation…
      </main>
    );
  }
  return (
    <PresenterScreen
      title={deck.title}
      srcdoc={srcdoc}
      channel={frameChannel}
      frames={frames}
      index={index}
      now={now}
      elapsed={now - started}
      onGo={go}
      onResetTimer={() => {
        setStarted(Date.now());
        setNow(Date.now());
      }}
    />
  );
}

/** Clock, timer, the current and the next slide, the notes, previous and next. */
export function PresenterScreen({
  title,
  srcdoc,
  channel,
  frames,
  index,
  now,
  elapsed,
  onGo,
  onResetTimer,
}: {
  title: string;
  /** The deck's frame document, and the channel baked into it. */
  srcdoc: string;
  channel: string;
  frames: readonly FrameInfo[];
  index: number;
  /** Epoch ms, for the clock. */
  now: number;
  /** Ms since the timer started. */
  elapsed: number;
  onGo: (index: number) => void;
  onResetTimer: () => void;
}) {
  const frame = frames[index]!;
  const step = (key: string) => {
    const i = stepFrame(key, index, frames, true);
    return i === null || i === index ? null : i;
  };
  const prev = step("ArrowLeft");
  const next = step("ArrowRight");
  const seconds = Math.floor(Math.max(0, elapsed) / 1000);
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <main className="flex h-svh flex-col bg-background text-text-primary">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate font-heading text-subtitle font-semibold">{title}</h1>
        <span className="text-body2 text-text-secondary tabular-nums">
          {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span data-testid="presenter-timer" className="text-body2 text-text-secondary tabular-nums">
          Elapsed {timer}
        </span>
        <Button size="xs" variant="utility" onClick={onResetTimer}>
          Reset timer
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-wrap gap-4 overflow-auto p-4">
        <section aria-labelledby="presenter-current" className="flex flex-col gap-2">
          <h2 id="presenter-current" className="truncate text-caption1 text-text-secondary">
            Slide {index + 1} of {frames.length}: {frame.name}
          </h2>
          <FrameThumb srcdoc={srcdoc} channel={channel} index={index} frame={frame} width={720} transition={frame.transition} />
        </section>
        <div className="flex min-w-72 flex-1 flex-col gap-4">
          <section aria-labelledby="presenter-next" className="flex flex-col gap-2">
            <h2 id="presenter-next" className="text-caption1 text-text-secondary">
              Next
            </h2>
            {next !== null ? (
              <FrameThumb srcdoc={srcdoc} channel={channel} index={next} frame={frames[next]!} width={320} />
            ) : (
              <p className="text-body2 text-text-secondary">End of the presentation</p>
            )}
          </section>
          <section aria-labelledby="presenter-notes" className="flex min-h-0 flex-col gap-2">
            <h2 id="presenter-notes" className="text-caption1 text-text-secondary">
              Speaker notes
            </h2>
            <p data-testid="presenter-notes" className="text-body1 whitespace-pre-line">
              {frame.notes || "No notes for this slide."}
            </p>
          </section>
        </div>
      </div>
      <footer className="flex items-center justify-center gap-2 border-t border-border px-4 py-2">
        <Button size="xs" variant="utility" disabled={prev === null} onClick={() => prev !== null && onGo(prev)}>
          <ChevronLeftIcon />
          Previous
        </Button>
        <Button size="xs" variant="utility" disabled={next === null} onClick={() => next !== null && onGo(next)}>
          Next
          <ChevronRightIcon />
        </Button>
      </footer>
    </main>
  );
}
