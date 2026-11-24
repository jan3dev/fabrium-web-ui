import { describe, expect, it } from "vitest";
import { addConsoleEntry, frameUrl, MAX_CONSOLE_ENTRIES, readBridgeMessage, sameSite } from "./bridge";

const ORIGIN = "https://3f9c.fabrium-preview.net";
const msg = (m: Record<string, unknown>) => readBridgeMessage({ source: "fabrium-preview", ...m }, ORIGIN);

describe("preview bridge", () => {
  it("reads the page path, only on the session origin", () => {
    expect(msg({ type: "location", href: `${ORIGIN}/todos?filter=done#x` })).toEqual({
      type: "location",
      path: "/todos?filter=done#x",
    });
    expect(msg({ type: "location", href: "https://evil.example/todos" })).toBeNull();
    expect(readBridgeMessage({ type: "location", href: `${ORIGIN}/` }, ORIGIN)).toBeNull();
  });

  it("caps console entries and keeps the latest 50", () => {
    expect(msg({ type: "console", message: "x".repeat(5000) })).toEqual({ type: "console", message: "x".repeat(2048) });
    expect(msg({ type: "console", message: "  " })).toBeNull();
    const many = Array.from({ length: 60 }, (_, i) => String(i));
    const kept = many.reduce<readonly string[]>((list, m) => addConsoleEntry(list, m), []);
    expect(kept).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(kept[0]).toBe("10");
    expect(addConsoleEntry(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("reads a picked element with its page, on one line", () => {
    expect(
      msg({ type: "picked", href: `${ORIGIN}/todos`, selector: "ul >\nli", html: "<li>Milk</li>", text: "Milk" }),
    ).toEqual({
      type: "picked",
      path: "/todos",
      target: { kind: "element", selector: "ul > li", html: "<li>Milk</li>", text: "Milk" },
    });
    expect(msg({ type: "picked", href: `${ORIGIN}/`, html: "<li/>" })).toBeNull();
  });

  it("navigates typed paths only on the session origin", () => {
    expect(frameUrl("/todos?x=1", ORIGIN)).toBe(`${ORIGIN}/todos?x=1`);
    expect(frameUrl("todos", ORIGIN)).toBe(`${ORIGIN}/todos`);
    expect(frameUrl("", ORIGIN)).toBe(`${ORIGIN}/`);
    expect(frameUrl("//evil.example/x", ORIGIN)).toBeNull();
    expect(frameUrl("https://evil.example/x", ORIGIN)).toBe(`${ORIGIN}/https://evil.example/x`);
  });

  it("tells a preview host on Fabrium's site from a separate one", () => {
    expect(sameSite("abc.preview.example.net", "fabrium.example.net")).toBe(true);
    expect(sameSite("abc.fabrium-preview.net", "fabrium.example.net")).toBe(false);
    expect(sameSite("abc.preview.localhost", "localhost")).toBe(false);
  });
});
