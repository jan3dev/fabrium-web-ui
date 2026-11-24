import { keyedDraftStore } from "@/lib/quote-draft-store";

/**
 * A user's annotation on one part of an artifact. It travels in the message as
 * `dev.fabrium.artifact_refs` and, for the agent, as a plain-text fallback
 * appended to `body` (same pattern as `dev.zooid.quote`).
 */
export const ARTIFACT_REFS_FIELD = "dev.fabrium.artifact_refs";
export const MAX_REFS = 10;
export const MAX_REF_SNIPPET = 1500;
export const MAX_NOTE = 2000;

export type ArtifactRefTarget =
  | { kind: "element"; selector: string; html: string; text: string }
  /** `where` says where the text sits: a section heading or a line range. */
  | { kind: "text"; text: string; where?: string };

export interface ArtifactRef {
  identifier: string;
  title: string;
  version: number;
  event_id: string;
  target: ArtifactRefTarget;
  note: string;
  /**
   * Set when the annotation is on a live app preview, not an artifact: the
   * preview's agent and the page path. `identifier` is the preview name,
   * `event_id` its latest event, `version` 0.
   */
  preview?: { agent: string; path: string };
}

/**
 * A message of comments the user did not send to the agent (spec §6.6): the daemon's router wakes
 * no agent for it. It carries no typed text, only the references.
 */
export const QUIET_FIELD = "dev.fabrium.quiet";

/** A reference waiting in the composer. The extra fields stay local; `wireRef` drops them. */
export interface ArtifactRefDraft extends ArtifactRef {
  /** "Send to agent" is off: it goes in a quiet message of its own. */
  quiet?: boolean;
  /** The agent a sent comment mentions: the artifact's author or the preview's agent. */
  agent?: string;
  /** A drawn markup (spec §3.8 Draw): its frame and stroke, in the frame's own pixels, shown until sent. */
  sketch?: { index: number; points: readonly Point[] };
}

export function wireRef({ quiet: _quiet, agent: _agent, sketch: _sketch, ...ref }: ArtifactRefDraft): ArtifactRef {
  return ref;
}

export type Point = readonly [x: number, y: number];

/**
 * A drawn markup as a reference: the frame and the stroke's bounding box in the frame's own
 * pixels (0 to `width` by 0 to `height`, whatever the zoom), clamped to the frame. It is a text
 * target, so the agent reads it in the body like any annotation. Null when the stroke misses
 * the frame or is a dot.
 * ponytail: the region only, never the stroke's shape; send the path when an agent can use it.
 */
export function sketchTarget(
  unit: "slide" | "artboard",
  index: number,
  name: string,
  points: readonly Point[],
  width: number,
  height: number,
): ArtifactRefTarget | null {
  if (points.length === 0) return null;
  const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = clamp(Math.min(...xs), width);
  const y = clamp(Math.min(...ys), height);
  const w = clamp(Math.max(...xs), width) - x;
  const h = clamp(Math.max(...ys), height) - y;
  if (w === 0 || h === 0) return null;
  const frame = `${unit} ${index + 1}`;
  return {
    kind: "text",
    where: `sketch on ${frame}${name ? ` "${name}"` : ""}`.slice(0, 200),
    text: `region x=${x}, y=${y}, w=${w}, h=${h} on ${frame}, in its own pixels (${width}x${height})`,
  };
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.slice(0, max) : null;

export function readTarget(raw: unknown): ArtifactRefTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const text = str(t.text, MAX_REF_SNIPPET) ?? "";
  if (t.kind === "element") {
    // A frame controls the selector and it lands in the user's message unfenced: one line only.
    const selector = str(t.selector, 300)?.replace(/\s+/g, " ").trim();
    const html = str(t.html, MAX_REF_SNIPPET);
    return selector && html !== null
      ? { kind: "element", selector, html, text }
      : null;
  }
  if (t.kind === "text" && text) {
    const where = str(t.where, 200);
    return where ? { kind: "text", text, where } : { kind: "text", text };
  }
  return null;
}

/** A page path from a frame: one line, it lands in the user's message unfenced. */
export function onePath(raw: unknown): string | null {
  const path = str(raw, 500)?.replace(/\s+/g, "").trim();
  return path?.startsWith("/") ? path : null;
}

function readPreview(raw: unknown): ArtifactRef["preview"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const agent = str(o.agent, 255);
  const path = onePath(o.path);
  return agent && path ? { agent, path } : undefined;
}

/** Valid refs from message content (or a frame's message); anything malformed is dropped. */
export function readArtifactRefs(content: unknown): ArtifactRef[] {
  const raw = (content as Record<string, unknown> | null)?.[
    ARTIFACT_REFS_FIELD
  ];
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_REFS).flatMap((r): ArtifactRef[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const target = readTarget(o.target);
    const identifier = str(o.identifier, 80);
    const eventId = str(o.event_id, 255);
    if (!target || !identifier || !eventId || typeof o.version !== "number")
      return [];
    const preview = readPreview(o.preview);
    return [
      {
        identifier,
        title: str(o.title, 200) || identifier,
        version: o.version,
        event_id: eventId,
        target,
        note: str(o.note, MAX_NOTE) ?? "",
        ...(preview ? { preview } : {}),
      },
    ];
  });
}

/** A fence that its own content cannot close. */
function fence(lang: string, content: string): string {
  const longest = Math.max(
    2,
    ...[...content.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

/** What the agent reads. Deterministic, so the client can strip it from `body` again. */
export function formatArtifactRefs(refs: readonly ArtifactRef[]): string {
  return refs
    .map((r, i) => {
      const head = r.preview
        ? `[Annotation ${i + 1} on the preview \`${r.identifier}\` "${r.title}" at ${r.preview.path} (event ${r.event_id})]`
        : `[Annotation ${i + 1} on artifact \`${r.identifier}\` v${r.version} "${r.title}" (event ${r.event_id})]`;
      const t = r.target;
      const lines =
        t.kind === "element"
          ? [head, `Element: ${t.selector}`, fence("html", t.html)]
          : [
              head,
              t.where ? `Text (${t.where}):` : "Text:",
              fence("text", t.text),
            ];
      if (r.note.trim()) lines.push(`Note: ${r.note.trim()}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function appendArtifactRefs(
  comment: string,
  refs: readonly ArtifactRef[],
): string {
  if (refs.length === 0) return comment;
  const fallback = formatArtifactRefs(refs);
  return comment ? `${comment}\n\n${fallback}` : fallback;
}

/** The comment without the fallback; the body unchanged when it does not end with one. */
export function stripArtifactRefs(
  body: string,
  refs: readonly ArtifactRef[],
): string {
  if (refs.length === 0) return body;
  const fallback = formatArtifactRefs(refs);
  if (body === fallback) return "";
  return body.endsWith(`\n\n${fallback}`)
    ? body.slice(0, -fallback.length - 2)
    : body;
}

// Annotations waiting in a thread composer, keyed like the quote drafts.
const EMPTY: ArtifactRefDraft[] = [];
const drafts = keyedDraftStore<ArtifactRefDraft[]>(EMPTY);

export const getArtifactRefDrafts = drafts.get;
export const useArtifactRefDrafts = drafts.use;

export function setArtifactRefDrafts(
  roomId: string,
  threadId: string | null,
  refs: ArtifactRefDraft[],
) {
  drafts.set(roomId, threadId, refs.length ? refs.slice(0, MAX_REFS) : EMPTY);
}

/** False when the composer already holds the most annotations a message carries. */
export function addArtifactRefDraft(
  roomId: string,
  threadId: string | null,
  ref: ArtifactRefDraft,
): boolean {
  const refs = drafts.get(roomId, threadId);
  if (refs.length >= MAX_REFS) return false;
  drafts.set(roomId, threadId, [...refs, ref]);
  return true;
}
