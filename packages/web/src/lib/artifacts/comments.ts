import type { ActorSummary, ArtifactKind, TimelineMessage } from "@/model/types";
import type { ArtifactRef } from "./refs";

/**
 * Comments (DESIGN_MODES_SPEC.md §6.6): a thread message with an artifact reference, as an
 * annotation is. Nothing new is stored; open or resolved is read from the thread. A comment
 * is resolved by a human's ✓, or when a later version no longer has its target.
 */

/** The reaction the Resolve button sends. */
export const RESOLVE_KEY = "✓";
/** Reactions that resolve a comment when a human adds them. */
const RESOLVE_KEYS = new Set([RESOLVE_KEY, "✔", "✔️", "✅", "☑️"]);

export interface ArtifactComment {
  /** `<message id>:<index>`: one message can carry several references. */
  id: string;
  messageId: string;
  author: ActorSummary;
  ref: ArtifactRef;
  /** The message's own text, beside the reference's note. */
  text: string;
}

/** The latest version of the artifact, to check whether a comment's target is still in it. */
export interface LatestVersion {
  eventId: string;
  /** False when the version's source has no element for the selector. */
  has: (selector: string) => boolean;
}

/** The artifact's open comments in thread order. */
export function artifactComments(
  messages: readonly TimelineMessage[],
  identifier: string,
  isHuman: (userId: string) => boolean,
  latest?: LatestVersion,
): ArtifactComment[] {
  return messages.flatMap((m) => {
    if (m.redacted || !m.artifactRefs) return [];
    if (m.reactions.some((r) => RESOLVE_KEYS.has(r.emoji) && r.actorIds.some(isHuman))) return [];
    return m.artifactRefs.flatMap((ref, i): ArtifactComment[] => {
      if (ref.identifier !== identifier || ref.preview) return [];
      const gone =
        latest !== undefined &&
        ref.event_id !== latest.eventId &&
        ref.target.kind === "element" &&
        !latest.has(ref.target.selector);
      return gone ? [] : [{ id: `${m.id}:${i}`, messageId: m.id, author: m.author, ref, text: m.body }];
    });
  });
}

/** Kinds whose source is the document the frame shows, so a selector can be checked against it. */
const DOM_KINDS: ReadonlySet<ArtifactKind> = new Set(["html", "svg", "slides", "design"]);

/**
 * `has` for a version's source, parsed inert (no script runs). Other kinds, and a selector the
 * parser rejects, count as found: they never resolve a comment.
 */
export function sourceHas(kind: ArtifactKind, text: string): (selector: string) => boolean {
  if (!DOM_KINDS.has(kind)) return () => true;
  // Parsed on the first check: most threads have no element comments.
  let doc: Document | null = null;
  return (selector) => {
    try {
      doc ??= new DOMParser().parseFromString(text, "text/html");
      return doc.querySelector(selector) !== null;
    } catch {
      return true;
    }
  };
}
