import { describe, expect, it } from "vitest";
import { buildArtifactSrcdoc, PREVIEW_CSP, PREVIEW_SANDBOX, PRINT_SANDBOX } from "./srcdoc";

describe("artifact srcdoc", () => {
  it("never lets the frame share the app's origin", () => {
    expect(PREVIEW_SANDBOX).not.toContain("allow-same-origin");
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
  });

  it("puts the CSP before any agent markup, whatever tags the agent wrote", () => {
    const doc = buildArtifactSrcdoc("html", "<header>x</header><script>leak()</script><!-- <head> --><p>", "c1");
    expect(doc.startsWith('<head><meta http-equiv="Content-Security-Policy"')).toBe(true);
    const withDoctype = buildArtifactSrcdoc("html", "<!DOCTYPE html><script>leak()</script><head>", "c1");
    expect(withDoctype.startsWith('<!DOCTYPE html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
  });

  it("puts the CSP inside the artifact's own head, before its scripts", () => {
    const doc = buildArtifactSrcdoc("html", "<html><head><script>x()</script></head><body>$&</body></html>", "c1");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("x()"));
    expect(doc).toContain("<body>$&</body>");
    expect(doc).toContain('"c1"');
  });

  it("asks for the React runtimes and escapes the component source", () => {
    const doc = buildArtifactSrcdoc("react", "export default () => <p>{'</script>'}</p>", "c1");
    expect(doc).toContain('["tailwind","react","jsx"]');
    expect(doc).not.toContain("{'</script>'}");
  });

  it("strips multi-line imports from a React component, and only imports", () => {
    const doc = buildArtifactSrcdoc("react", "", "c1");
    const literal = /\.replace\((\/\^\[ \\t\]\*import.*?\/gm)/.exec(doc)![1];
    const strip = (0, eval)(literal) as RegExp;
    const src = 'import {\n  useState,\n} from "react";\nimport "./x.css";\nconst importance = 1;';
    expect(src.replace(strip, "").trim()).toBe("const importance = 1;");
  });

  it("adds the frames runtime for slides, design and motion only, after the CSP", () => {
    const deck = "<!doctype html><html><body><section><h1>A</h1></section></body></html>";
    for (const kind of ["slides", "design", "motion"] as const) {
      const doc = buildArtifactSrcdoc(kind, deck, "c1");
      expect(doc.startsWith('<!doctype html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
      expect(doc).toContain("body > section");
      expect(doc).toContain(`var SLIDES = ${kind === "slides"}, PRINT = false,`);
    }
    expect(buildArtifactSrcdoc("html", deck, "c1")).not.toContain("body > section");
  });

  it("adds the motion runtime for motion only, with scenes 1920×1080 by default", () => {
    const doc = buildArtifactSrcdoc("motion", "<section></section>", "c1");
    expect(doc).toContain("onSeek = function(d)");
    expect(doc).toContain("var DEFAULT = [1920,1080];");
    expect(buildArtifactSrcdoc("design", "<section></section>", "c1")).not.toContain("onSeek = function(d)");
  });

  it("emits a hook script that parses, also for print and motion", () => {
    for (const [kind, print] of [["slides", false], ["slides", true], ["motion", false]] as const) {
      const doc = buildArtifactSrcdoc(kind, "<section></section>", "c1", print);
      const script = /<script>([\s\S]*?)<\/script>/.exec(doc)![1]!;
      expect(() => new Function(script)).not.toThrow();
      expect(doc).toContain(`PRINT = ${print}`);
    }
  });

  it("hides notes on the frame and animates only without reduced motion", () => {
    const doc = buildArtifactSrcdoc("slides", "<section></section>", "c1");
    expect(doc).toContain("body>section>aside[data-notes]{display:none!important}");
    expect(doc).toContain("@media (prefers-reduced-motion:no-preference)");
  });

  it("gives only the print frame dialogs, and never the app's origin", () => {
    expect(PRINT_SANDBOX).toContain("allow-modals");
    expect(PRINT_SANDBOX).not.toContain("allow-same-origin");
    expect(PREVIEW_SANDBOX).not.toContain("allow-modals");
  });
});
