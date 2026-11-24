import { describe, expect, it } from "vitest";
import { composeAgentRequest } from "./runtime";

describe("composeAgentRequest", () => {
  const deck = { identifier: "launch", version: 3, kind: "slides" as const };
  const design = { identifier: "app", version: 2, kind: "design" as const };

  it("names the artifact and its version, in the tool text's words", () => {
    expect(composeAgentRequest("pptx", deck)).toBe(
      "Please export artifact `launch` v3 as PowerPoint (.pptx). Keep text, tables, pictures, backgrounds and speaker notes editable. Skipped slides and transitions are left out. Send the file in this thread.",
    );
    expect(composeAgentRequest("pptx", design)).toContain("one slide per artboard");
    expect(composeAgentRequest("google-slides", deck)).toBe(
      "Please export artifact `launch` v3 for Google Slides: a PowerPoint (.pptx) with basic fonts that I import into Google Slides. Skipped slides and transitions are left out. Send the file in this thread.",
    );
    expect(composeAgentRequest("mp4", { identifier: "intro", version: 1, kind: "motion" })).toBe(
      "Please export artifact `intro` v1 as MP4: render it frame by frame, every scene for its duration. Send the file in this thread.",
    );
    expect(composeAgentRequest("build", design)).toBe(
      "Build this design: artifact `app` v2. Read it, its builder notes (<aside data-note>) and its design system, build the screens as a working app in your workspace, and show it to me as a live preview.",
    );
  });

  it("names the slide or artboard a PNG shows, or the whole whiteboard", () => {
    expect(composeAgentRequest("png", deck, { index: 2, name: "Pricing" })).toBe(
      'Please export slide 3 "Pricing" of artifact `launch` v3 as PNG at its canvas size. Send the file in this thread.',
    );
    expect(composeAgentRequest("png", design, { index: 0, name: "" })).toContain("artboard 1 of artifact `app` v2");
    expect(composeAgentRequest("png", { identifier: "map", version: 4, kind: "whiteboard" })).toBe(
      "Please export the whole whiteboard artifact `map` v4 as PNG. Send the file in this thread.",
    );
  });
});
