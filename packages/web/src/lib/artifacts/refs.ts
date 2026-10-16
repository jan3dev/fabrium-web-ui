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
    return [
      {
        identifier,
        title: str(o.title, 200) || identifier,
        version: o.version,
        event_id: eventId,
        target,
        note: str(o.note, MAX_NOTE) ?? "",
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
      const head = `[Annotation ${i + 1} on artifact \`${r.identifier}\` v${r.version} "${r.title}" (event ${r.event_id})]`;
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
const EMPTY: ArtifactRef[] = [];
const drafts = keyedDraftStore<ArtifactRef[]>(EMPTY);

export const getArtifactRefDrafts = drafts.get;
export const useArtifactRefDrafts = drafts.use;

export function setArtifactRefDrafts(
  roomId: string,
  threadId: string | null,
  refs: ArtifactRef[],
) {
  drafts.set(roomId, threadId, refs.length ? refs.slice(0, MAX_REFS) : EMPTY);
}

/** False when the composer already holds the most annotations a message carries. */
export function addArtifactRefDraft(
  roomId: string,
  threadId: string | null,
  ref: ArtifactRef,
): boolean {
  const refs = drafts.get(roomId, threadId);
  if (refs.length >= MAX_REFS) return false;
  drafts.set(roomId, threadId, [...refs, ref]);
  return true;
}
