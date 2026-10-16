import { describe, expect, it } from "vitest";
import { buildArtifactSrcdoc, PREVIEW_CSP, PREVIEW_SANDBOX } from "./srcdoc";

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
});

