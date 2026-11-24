import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Scene, sceneAt, totalDuration } from "@/lib/artifacts/motion";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export type MotionClock = ReturnType<typeof useMotionClock>;

/**
 * The clock of a motion artifact (spec §6.11). The app owns time: while playing, a
 * `requestAnimationFrame` loop advances it, and every change goes to `onFrame` as the scene and
 * the time inside it, for the frame to hold its animations at. The time itself is a small store
 * (`useMotionTime`), so only the transport re-renders on every tick; the open scene is state.
 * Each artifact (`id`) starts at 0 and plays, unless the user prefers reduced motion.
 */
export function useMotionClock(
  id: string | undefined,
  scenes: readonly Scene[],
  /** False while the stage is not shown (another tab): the loop stops, `playing` stays. */
  active: boolean,
  onFrame: (index: number, time: number) => void,
) {
  const total = totalDuration(scenes);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [scene, setScene] = useState(0);
  const store = useRef({ time: 0, listeners: new Set<() => void>() });
  const latest = useRef({ scenes, total, loop, onFrame });
  latest.current = { scenes, total, loop, onFrame };

  const seek = useCallback((t: number) => {
    const { scenes, total, onFrame } = latest.current;
    const s = store.current;
    s.time = Math.min(total, Math.max(0, Number.isFinite(t) ? t : 0));
    const at = sceneAt(scenes, s.time);
    setScene(at.index);
    onFrame(at.index, at.time);
    s.listeners.forEach((l) => l());
  }, []);

  useEffect(() => {
    seek(0);
    setPlaying(!reducedMotion());
  }, [id, seek]);
  // An edit that changes the durations keeps the time, clamped to the new total.
  useEffect(() => seek(store.current.time), [scenes, seek]);

  useEffect(() => {
    if (!playing || !active || total === 0) return;
    let last = performance.now();
    const tick = (now: number) => {
      const { total, loop } = latest.current;
      // Capped: a hidden tab gets no frames, and its time away is not time played.
      let t = store.current.time + Math.min(now - last, 100);
      last = now;
      if (t >= total) {
        if (!loop) {
          seek(total);
          setPlaying(false);
          return;
        }
        t %= total;
      }
      seek(t);
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, total, seek]);

  const play = useCallback(() => {
    // From the end, play starts over.
    if (store.current.time >= latest.current.total) seek(0);
    setPlaying(true);
  }, [seek]);
  const pause = useCallback(() => setPlaying(false), []);
  const subscribe = useCallback((l: () => void) => {
    store.current.listeners.add(l);
    return () => void store.current.listeners.delete(l);
  }, []);
  const getTime = useCallback(() => store.current.time, []);

  return {
    scene,
    playing,
    loop,
    total,
    setLoop,
    play,
    pause,
    toggle: playing ? pause : play,
    seek,
    /** The frame reloaded: send it the current scene and time again. */
    resend: useCallback(() => seek(store.current.time), [seek]),
    subscribe,
    getTime,
  };
}

/** The clock's time in ms, re-rendering the caller on every tick. */
export function useMotionTime(clock: Pick<MotionClock, "subscribe" | "getTime">): number {
  return useSyncExternalStore(clock.subscribe, clock.getTime);
}
