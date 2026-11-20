import { describe, expect, it } from "vitest";
import { projectNameError, sameProjectName } from "./project-name";

const RULE = "A project name has 1 to 64 characters, with no control characters.";

describe("projectNameError", () => {
  it("projectNameError accepts 1 to 64 characters", () => {
    expect(projectNameError("Payments")).toBeNull();
    expect(projectNameError("a".repeat(64))).toBeNull();
    expect(projectNameError("  Payments  ")).toBeNull();
  });

  it("projectNameError refuses empty, 65 characters, and a control character", () => {
    expect(projectNameError("")).toBe(RULE);
    expect(projectNameError("   ")).toBe(RULE);
    expect(projectNameError("a".repeat(65))).toBe(RULE);
    expect(projectNameError("a\tb")).toBe(RULE);
  });

  it("projectNameError counts characters, not UTF-16 units", () => {
    expect(projectNameError("😀".repeat(64))).toBeNull();
    expect(projectNameError("😀".repeat(65))).toBe(RULE);
  });
});

describe("sameProjectName", () => {
  it("sameProjectName ignores the case of ASCII letters only", () => {
    expect(sameProjectName("Payments", "payments")).toBe(true);
    expect(sameProjectName("Payments", "Billing")).toBe(false);
    expect(sameProjectName("É", "é")).toBe(false);
  });
});
