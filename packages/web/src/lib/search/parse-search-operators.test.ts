// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/lib/parseSearchOperators.test.mjs. Modified.
import { describe, expect, it } from "vitest";
import { normalizeFromHandle, normalizeInRoom, parseSearchOperators } from "./parse-search-operators";

describe("parseSearchOperators", () => {
  it("leaves plain text unchanged", () => {
    expect(parseSearchOperators("  deploy  ")).toEqual({ text: "deploy", from: null, in: null });
  });

  it("extracts from / in and keeps the remaining search text", () => {
    expect(parseSearchOperators("deploy from:@alice:h in:#general status")).toEqual({
      text: "deploy status",
      from: "@alice:h",
      in: "#general",
    });
  });

  it("later operators of the same kind win", () => {
    const parsed = parseSearchOperators("from:@alice from:@bob in:one in:two");
    expect(parsed).toEqual({ text: "", from: "@bob", in: "two" });
  });

  it("does not treat hyphen or slash adjacent tokens as operators", () => {
    for (const raw of ["built-in:react hooks", "sign-in:flow broken", "https://x.com/in:foo"]) {
      expect(parseSearchOperators(raw)).toEqual({ text: raw, from: null, in: null });
    }
  });

  it("strips trailing punctuation from operator values", () => {
    const parsed = parseSearchOperators("deploy in:general, from:@alice.");
    expect(parsed).toEqual({ text: "deploy", from: "@alice", in: "general" });
  });

  it("normalizes handles and room names", () => {
    expect(normalizeFromHandle("@alice")).toBe("alice");
    expect(normalizeInRoom("#general")).toBe("general");
  });
});
