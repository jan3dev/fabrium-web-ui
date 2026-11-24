import { describe, expect, it } from "vitest";
import { FabriumApiError } from "../client/fabrium-api";
import { projectNameText, serverText } from "./fabrium-errors";

const MESSAGES: [string, string][] = [
  ["unknown project", "That project no longer exists. Pick another one."],
  ["a project agent needs a project vm", "A project agent runs only on a project VM."],
  ["the vm has project agents", "This VM has project agents, so it must stay in a project."],
  [
    "a project agent has no owner",
    "A project agent has no owner. Take it out of the project to give it one.",
  ],
  [
    "a project vm has no owner",
    "A project VM has no owner. Take it out of the project to give it one.",
  ],
  ["owner must be a person", "The owner must be a person, not an agent."],
  ["project in use", "Something belongs to this project. Move it out first."],
  [
    "invalid project name",
    "A project name has 1 to 64 characters, with no control characters.",
  ],
];

describe("serverText", () => {
  it.each(MESSAGES)("serverText maps %s", (message, text) => {
    expect(serverText(new FabriumApiError(400, message))).toBe(text);
  });

  it("serverText keeps a message that it does not know", () => {
    expect(serverText(new FabriumApiError(500, "boom"))).toBe("boom");
  });

  it("serverText keeps name in use as it is", () => {
    expect(serverText(new FabriumApiError(409, "name in use"))).toBe("name in use");
  });
});

describe("projectNameText", () => {
  it("projectNameText reads a 409 as a name in use", () => {
    expect(projectNameText(new FabriumApiError(409, "name in use"))).toBe(
      "A project with this name already exists.",
    );
  });

  it("projectNameText falls back to serverText", () => {
    expect(projectNameText(new FabriumApiError(400, "invalid project name"))).toBe(
      "A project name has 1 to 64 characters, with no control characters.",
    );
    expect(projectNameText(new FabriumApiError(409, "project in use"))).toBe(
      "Something belongs to this project. Move it out first.",
    );
  });
});
