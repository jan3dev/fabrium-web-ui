import type { ArtifactKind } from "@/model/types";
import { SLIDE_SIZES, type SlideSize } from "./frames";
import type { RuntimeModule } from "./srcdoc";

// The frame cannot fetch, so the parent loads runtimes from its own origin
// (vendored by scripts/build-artifact-runtime.mjs) and posts their source.
// A success is memoised for the page; a failure is not, so a retry can work.
const cache = new Map<RuntimeModule, Promise<string>>();

function load(name: RuntimeModule): Promise<string> {
  const hit = cache.get(name);
  if (hit) return hit;
  const pending = fetch(
    `${import.meta.env.BASE_URL}artifact-runtime/${name}.js`,
  )
    .then((r) => {
      // A missing file comes back as the app's index.html with a 200.
      if (!r.ok || r.headers.get("content-type")?.includes("text/html"))
        throw new Error(`Could not load the ${name} runtime (${r.status}).`);
      return r.text();
    })
    .catch((err: unknown) => {
      cache.delete(name);
      throw err instanceof Error
        ? err
        : new Error(`Could not load the ${name} runtime.`);
    });
  cache.set(name, pending);
  return pending;
}

/** In the order asked: Tailwind before React, React before Babel. */
export async function loadRuntimes(names: readonly RuntimeModule[]) {
  return Promise.all(
    names.map(async (name) => ({ name, source: await load(name) })),
  );
}

/** Errors the preview threw, deduplicated, capped: a frame can throw at 60 Hz. */
export function addPreviewError(
  errors: readonly string[],
  detail: unknown,
): readonly string[] {
  // One line each: the list goes into a message the user sends.
  const message = String(
    (detail as { message?: unknown } | null)?.message ?? "Error",
  )
    .replace(/\s+/g, " ")
    .slice(0, 500);
  return errors.includes(message) || errors.length >= 10
    ? errors
    : [...errors, message];
}

/** An ordinary thread message, phrased as the user would. */
export function composeFixRequest(
  identifier: string,
  errors: readonly string[],
): string {
  const list = errors.map((e) => `- ${e}`).join("\n");
  return `The preview of artifact \`${identifier}\` throws ${errors.length === 1 ? "an error" : `${errors.length} errors`}:\n${list}\nCan you fix it?`;
}

/** What the Export menu asks the agent for (spec §6.9). */
export type AgentRequest = "pptx" | "google-slides" | "png" | "mp4" | "build";

/**
 * As `composeFixRequest`: an Export menu entry the agent makes. It names the artifact and its
 * version, and `frame` the slide or artboard a PNG shows. The wording follows the daemon's tool
 * text (context-mcp `ARTIFACT_INSTRUCTIONS`), so its export and build rules apply.
 */
export function composeAgentRequest(
  request: AgentRequest,
  artifact: { identifier: string; version: number; kind: ArtifactKind },
  frame?: { index: number; name: string },
): string {
  const it = `artifact \`${artifact.identifier}\` v${artifact.version}`;
  const send = "Send the file in this thread.";
  const unit = artifact.kind === "slides" ? "slide" : "artboard";
  switch (request) {
    case "pptx":
      return `Please export ${it} as PowerPoint (.pptx)${artifact.kind === "design" ? ", one slide per artboard" : ""}. Keep text, tables, pictures, backgrounds and speaker notes editable. Skipped slides and transitions are left out. ${send}`;
    case "google-slides":
      return `Please export ${it} for Google Slides: a PowerPoint (.pptx) with basic fonts that I import into Google Slides. Skipped slides and transitions are left out. ${send}`;
    case "png":
      return artifact.kind === "whiteboard"
        ? `Please export the whole whiteboard ${it} as PNG. ${send}`
        : `Please export ${unit} ${(frame?.index ?? 0) + 1}${frame?.name ? ` "${frame.name}"` : ""} of ${it} as PNG at its canvas size. ${send}`;
    case "mp4":
      return `Please export ${it} as MP4: render it frame by frame, every scene for its duration. ${send}`;
    case "build":
      return `Build this design: ${it}. Read it, its builder notes (<aside data-note>) and its design system, build the screens as a working app in your workspace, and show it to me as a live preview.`;
  }
}

/** As `composeFixRequest`, after the user changed the deck's slide size. */
export function composeFitRequest(identifier: string, size: SlideSize): string {
  const [width, height] = SLIDE_SIZES[size];
  return `I changed the slides of artifact \`${identifier}\` to ${size} (${width}x${height} px). Can you check every slide and fit its content to the new size?`;
}
