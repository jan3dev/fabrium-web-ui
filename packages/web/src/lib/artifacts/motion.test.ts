import { describe, expect, it } from "vitest";
import { clampDuration, formatTime, readScenes, sceneAt, sceneStart, totalDuration } from "./motion";

describe("readScenes", () => {
  it("reads names and durations, clamped", () => {
    const html = `<!doctype html><body>
      <section data-name="Intro" data-duration="2000"><h1>Hello</h1></section>
      <section data-duration="50"><h2>  Big   title </h2></section>
      <section data-duration="9999999"></section>
      <section data-duration="soon"></section>
      <div><section data-duration="1000">nested, not a scene</section></div>
    </body>`;
    expect(readScenes(html)).toEqual([
      { name: "Intro", duration: 2000 },
      { name: "Big title", duration: 100 },
      { name: "Scene 3", duration: 600_000 },
      { name: "Scene 4", duration: 3000 },
    ]);
  });

  it("clamps durations from numbers and attributes", () => {
    expect(clampDuration(null)).toBe(3000);
    expect(clampDuration("")).toBe(3000);
    expect(clampDuration("3000ms")).toBe(3000);
    expect(clampDuration(Infinity)).toBe(3000);
    expect(clampDuration(" 1500.4 ")).toBe(1500);
    expect(clampDuration(-5)).toBe(100);
  });
});

describe("sceneAt", () => {
  const scenes = [
    { name: "a", duration: 2000 },
    { name: "b", duration: 3000 },
  ];
  it("maps global time to a scene and its local time", () => {
    expect(sceneAt(scenes, 0)).toEqual({ index: 0, time: 0 });
    expect(sceneAt(scenes, 1999)).toEqual({ index: 0, time: 1999 });
    expect(sceneAt(scenes, 2000)).toEqual({ index: 1, time: 0 });
    expect(sceneAt(scenes, 3500)).toEqual({ index: 1, time: 1500 });
    // The end, and past it, stays on the last scene's last frame; before 0 is 0.
    expect(sceneAt(scenes, 5000)).toEqual({ index: 1, time: 3000 });
    expect(sceneAt(scenes, 9000)).toEqual({ index: 1, time: 3000 });
    expect(sceneAt(scenes, -10)).toEqual({ index: 0, time: 0 });
    expect(sceneAt([], 100)).toEqual({ index: 0, time: 0 });
  });
  it("adds up starts and the total", () => {
    expect(sceneStart(scenes, 1)).toBe(2000);
    expect(totalDuration(scenes)).toBe(5000);
  });
});

it("formats time as m:ss.s", () => {
  expect(formatTime(0)).toBe("0:00.0");
  expect(formatTime(3549)).toBe("0:03.5");
  expect(formatTime(65_000)).toBe("1:05.0");
});
