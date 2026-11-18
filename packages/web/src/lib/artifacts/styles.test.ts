import { describe, expect, it } from "vitest";
import { blurOf, readColor, readStyles, shadowOf, shadows, styleNote, withBlur } from "./styles";

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

  it("round-trips drop and inner shadows through box-shadow", () => {
    const computed = "rgba(0, 0, 0, 0.3) 0px 4px 8px 0px, rgba(0, 0, 0, 0.3) 0px 0px 3px 0px inset";
    expect(shadowOf(computed, false)).toBe(8);
    expect(shadowOf(computed, true)).toBe(3);
    expect(shadowOf("none", false)).toBe(0);
    const made = shadows(12, 5);
    expect(shadowOf(made, false)).toBe(12);
    expect(shadowOf(made, true)).toBe(5);
    expect(shadows(0, 0)).toBe("none");
  });

  it("writes the changed properties as the note, skipping cleared ones", () => {
    expect(styleNote({ opacity: "0.5", "border-radius": "12px", filter: " " })).toBe(
      "Apply these style changes to the element:\nopacity: 0.5;\nborder-radius: 12px;",
    );
    expect(styleNote({})).toBe("");
  });
});
