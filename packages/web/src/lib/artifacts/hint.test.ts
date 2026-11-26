import { describe, expect, it } from "vitest";
import { createLine, parseCreateCommand, stripCreateCommand } from "./hint";

describe("parseCreateCommand", () => {
  it("reads the five commands with or without a request", () => {
    expect(parseCreateCommand("/slides a deck about Q3")).toEqual({ type: "slides", rest: "a deck about Q3" });
    expect(parseCreateCommand("/Design-System")).toEqual({ type: "design-system", rest: "" });
    expect(parseCreateCommand("/motion\nan intro")).toEqual({ type: "motion", rest: "an intro" });
  });
  it("ignores other text and other commands", () => {
    expect(parseCreateCommand("slides please")).toBeNull();
    expect(parseCreateCommand("/clear")).toBeNull();
    expect(parseCreateCommand("/slidesx")).toBeNull();
  });
});

describe("stripCreateCommand", () => {
  it("drops the command from the body and its HTML", () => {
    expect(stripCreateCommand("/design a login screen")).toBe("a login screen");
    expect(stripCreateCommand("<p>/design <strong>a login</strong></p>")).toBe("<p><strong>a login</strong></p>");
    expect(stripCreateCommand("/slides")).toBe("");
  });
});

it("names the kind in the plain-text line", () => {
  expect(createLine("design-system")).toBe("Create: Design system");
});
