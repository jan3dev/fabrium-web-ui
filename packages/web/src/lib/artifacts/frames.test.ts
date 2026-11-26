import { describe, expect, it } from "vitest";
import { clampZoom, readFrameKey, readFrames, stepFrame, stepZoom } from "./frames";

describe("readFrames", () => {
  it("reads names, sizes, notes, skip and transitions from the source", () => {
    const html = `<!doctype html><html><body data-transition="fade">
      <section data-title="  Title\n slide "><h1>Ignored</h1><aside data-notes>Say hi.\n\n  Then   wait.</aside></section>
      <section data-skip data-transition="SLIDE"><aside data-notes><h2>Not a name</h2></aside><h2>Why now</h2></section>
      <div><section><h1>Nested, not a frame</h1></section></div>
      <section data-transition="spin"><p>x</p></section>
      <script>document.body.append(document.createElement("section"))</script>
    </body></html>`;
    expect(readFrames("slides", html)).toEqual([
      { name: "Title slide", width: 1920, height: 1080, notes: "Say hi.\n\nThen wait.", skip: false, transition: "fade" },
      { name: "Why now", width: 1920, height: 1080, notes: "Not a name", skip: true, transition: "slide" },
      { name: "Slide 3", width: 1920, height: 1080, notes: "", skip: false, transition: "fade" },
    ]);
  });

  it("clamps design sizes and long names, and keeps at most 200 frames", () => {
    const [phone, odd] = readFrames(
      "design",
      `<section data-name="${"x".repeat(500)}" data-width="1e9" data-height="1"></section><section data-width="NaN"></section>`,
    );
    expect(phone).toMatchObject({ name: "x".repeat(120), width: 10000, height: 100 });
    expect(odd).toMatchObject({ name: "Screen 2", width: 1440, height: 900, transition: "none" });
    expect(readFrames("slides", "<section></section>".repeat(300))).toHaveLength(200);
    expect(readFrames("slides", "<p>no sections</p>")).toEqual([]);
  });
});

describe("frame keys", () => {
  it("reads only the forwarded keys", () => {
    expect(readFrameKey({ key: "PageDown" })).toBe("PageDown");
    expect(readFrameKey({ key: "7" })).toBe("7");
    expect(readFrameKey({ key: "Enter" })).toBeNull();
    expect(readFrameKey(undefined)).toBeNull();
  });

  const three = [{ skip: false }, { skip: false }, { skip: false }];

  it("steps within bounds", () => {
    expect(stepFrame("ArrowRight", 1, three)).toBe(2);
    expect(stepFrame("Space", 2, three)).toBe(2);
    expect(stepFrame(" ", 0, three)).toBe(1);
    expect(stepFrame("PageUp", 0, three)).toBe(0);
    expect(stepFrame("End", 0, three)).toBe(2);
    expect(stepFrame("Home", 2, three)).toBe(0);
    expect(stepFrame("Enter", 0, three)).toBeNull();
    expect(stepFrame("ArrowRight", 0, [])).toBeNull();
  });

  it("adds Up, Down and digits only while presenting, and skips skipped frames there", () => {
    const deck = [{ skip: true }, { skip: false }, { skip: true }, { skip: false }];
    expect(stepFrame("ArrowDown", 0, deck)).toBeNull();
    expect(stepFrame("2", 0, deck)).toBeNull();
    expect(stepFrame("ArrowRight", 1, deck)).toBe(2);
    expect(stepFrame("ArrowRight", 1, deck, true)).toBe(3);
    expect(stepFrame("ArrowUp", 3, deck, true)).toBe(1);
    expect(stepFrame("Home", 3, deck, true)).toBe(1);
    expect(stepFrame("2", 1, deck, true)).toBe(3);
    expect(stepFrame("3", 1, deck, true)).toBeNull();
    expect(stepFrame("End", 0, [{ skip: true }], true)).toBeNull();
  });

  it("zooms in steps", () => {
    expect(stepZoom(null, 1)).toBe(1);
    expect(stepZoom(null, -1)).toBe(0.5);
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    // From a free zoom: the next level that way.
    expect(stepZoom(1.37, 1)).toBe(2);
    expect(stepZoom(1.37, -1)).toBe(1);
    expect(stepZoom(3.2, 1)).toBe(3.2);
    expect([clampZoom(0.4166 * 1.1), clampZoom(0.01), clampZoom(99)]).toEqual([0.46, 0.1, 10]);
  });
});
