import { describe, expect, it } from "vitest";
import {
  blurOf,
  contrast,
  flipScale,
  layoutOf,
  NO_SHADOW,
  readColor,
  readStyles,
  shadowOf,
  shadows,
  skewOf,
  styleNote,
  withBlur,
  withSkew,
  writeLayout,
} from "./styles";

describe("inspector styles", () => {
  it("keeps only known properties from a frame, on one short line", () => {
    expect(readStyles({ opacity: "0.5", position: "fixed", filter: "blur(2px)\n  x", color: 3 })).toEqual({
      opacity: "0.5",
      filter: "blur(2px) x",
    });
    expect(readStyles({ filter: "x".repeat(500) }).filter).toHaveLength(120);
    expect(readStyles(null)).toEqual({});
  });

  it("reads a computed colour for the colour input", () => {
    expect(readColor("rgb(20, 20, 19)")).toEqual({ hex: "#141413", none: false });
    expect(readColor("rgba(255, 0, 0, 0.5)")).toEqual({ hex: "#ff0000", none: false });
    expect(readColor("rgba(0, 0, 0, 0)")).toEqual({ hex: "#000000", none: true });
    expect(readColor("rgb(0 128 255 / 0)").none).toBe(true);
    expect(readColor("color(srgb 1 0 0)")).toEqual({ hex: "#000000", none: true });
  });

  it("sets and reads the blur of a filter list without touching the rest", () => {
    expect(blurOf("grayscale(1) blur(4px)")).toBe(4);
    expect(blurOf("none")).toBe(0);
    expect(withBlur("none", 6)).toBe("blur(6px)");
    expect(withBlur("grayscale(1) blur(4px)", 8)).toBe("grayscale(1) blur(8px)");
    expect(withBlur("blur(4px)", 0)).toBe("none");
    expect(withBlur("blur(4px) brightness(2)", 8)).toBe("blur(8px) brightness(2)");
    expect(withBlur("url(#none-x)", 2)).toBe("url(#none-x) blur(2px)");
  });

  it("round-trips drop and inner shadows with offset, spread and colour", () => {
    const computed = "rgba(0, 0, 0, 0.3) 0px 4px 8px 0px, rgb(255, 0, 0) 1px 2px 3px 4px inset";
    expect(shadowOf(computed, false)).toEqual({ x: 0, y: 4, blur: 8, spread: 0, color: "rgba(0, 0, 0, 0.3)" });
    expect(shadowOf(computed, true)).toEqual({ x: 1, y: 2, blur: 3, spread: 4, color: "rgb(255, 0, 0)" });
    expect(shadowOf("none", false)).toEqual(NO_SHADOW);
    const made = shadows({ ...NO_SHADOW, y: 2, blur: 12 }, { ...NO_SHADOW, spread: 5, color: "#ff0000" });
    expect(made).toBe("0px 2px 12px 0px rgba(0, 0, 0, 0.3), inset 0px 0px 0px 5px #ff0000");
    expect(shadowOf(made, true)).toMatchObject({ spread: 5, color: "#ff0000" });
    expect(shadows(NO_SHADOW, NO_SHADOW)).toBe("none");
  });

  it("reads and writes skew, flips and layout direction", () => {
    expect(skewOf("skew(10deg, -5deg)")).toEqual([10, -5]);
    expect(skewOf("matrix(1, 0, 0.176327, 1, 0, 0)")).toEqual([10, 0]);
    expect(withSkew(0, 0)).toBe("none");
    expect(flipScale("none", "h")).toBe("-1 1");
    expect(flipScale("-1 1", "h")).toBe("none");
    expect(flipScale("2", "v")).toBe("2 -2");
    expect(layoutOf({ display: "flex", "flex-direction": "column" })).toBe("column");
    expect(layoutOf({ display: "inline-grid" })).toBe("grid");
    expect(writeLayout("row")).toEqual({ display: "flex", "flex-direction": "row" });
  });

  it("checks text contrast against WCAG AA, with 3:1 for large text", () => {
    expect(contrast({ color: "rgb(0, 0, 0)" }, "rgb(255, 255, 255)")).toBe("good");
    expect(contrast({ color: "rgb(150, 150, 150)", "font-size": "16px" }, "rgb(255, 255, 255)")).toBe("poor");
    expect(contrast({ color: "rgb(130, 130, 130)", "font-size": "32px" }, "rgb(255, 255, 255)")).toBe("good");
    expect(contrast({ color: "rgba(0, 0, 0, 0)" }, "rgb(255, 255, 255)")).toBeNull();
  });

  it("writes the changed properties as the note, skipping cleared ones", () => {
    expect(styleNote({ opacity: "0.5", "border-radius": "12px", filter: " " })).toBe(
      "Apply these style changes to the element:\nopacity: 0.5;\nborder-radius: 12px;",
    );
    expect(styleNote({})).toBe("");
  });
});
