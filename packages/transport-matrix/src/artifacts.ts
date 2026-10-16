import { createHash } from "node:crypto";
import {
  ARTIFACT_KINDS,
  type ArtifactEdit,
  type ArtifactInput,
  type ArtifactKind,
} from "@zooid/core";

/** One version of an artifact; the web client folds them by thread + identifier. */
export const ARTIFACT_EVENT_TYPE = "dev.fabrium.artifact.version";
/** Matrix events max out at 64 KB; bigger bodies go to the media repo (plan §5). */
export const MAX_INLINE_ARTIFACT_BYTES = 48_000;
export const MAX_ARTIFACT_BYTES = 512_000;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** What a stored version carries; `body` inline or `url` + `sha256` in media. */
export interface StoredArtifact {
  identifier: string;
  type: ArtifactKind;
  title: string;
  language?: string;
  body?: string;
  url?: string;
  sha256?: string;
  size?: number;
}

/** Throws a message meant for the model: it says what to change. */
export function validateArtifactInput(input: ArtifactInput): void {
  if (!IDENTIFIER.test(input.identifier ?? "")) {
    throw new Error(
      'invalid_identifier: use kebab-case, e.g. "signup-form" (max 80 chars).',
    );
  }
  if (input.type !== undefined && !ARTIFACT_KINDS.includes(input.type)) {
    throw new Error(`invalid_type: one of ${ARTIFACT_KINDS.join(", ")}.`);
  }
  const hasContent = typeof input.content === "string";
  const hasEdits = Array.isArray(input.edits) && input.edits.length > 0;
  if (hasContent === hasEdits) {
    throw new Error(
      "invalid_input: pass either `content` (full version) or `edits`, not both or neither.",
    );
  }
  if (hasContent && !input.type) {
    throw new Error("invalid_input: `type` is required with `content`.");
  }
  if ((input.title?.length ?? 0) > 200 || (input.language?.length ?? 0) > 40) {
    throw new Error("invalid_input: keep `title` under 200 and `language` under 40 characters.");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Exact match first, then whitespace-tolerant: models mis-copy indentation. */
function findOnce(
  content: string,
  needle: string,
): { start: number; end: number } | "missing" | "ambiguous" {
  const first = content.indexOf(needle);
  if (first !== -1) {
    return content.indexOf(needle, first + 1) === -1
      ? { start: first, end: first + needle.length }
      : "ambiguous";
  }
  const trimmed = needle.trim();
  if (trimmed === "") return "missing";
  const matches = [
    ...content.matchAll(
      new RegExp(escapeRegExp(trimmed).replace(/\s+/g, "\\s+"), "g"),
    ),
  ];
  if (matches.length === 0) return "missing";
  if (matches.length > 1) return "ambiguous";
  const m = matches[0]!;
  return { start: m.index, end: m.index + m[0].length };
}

/** Apply every edit in order, or throw naming the first one that does not apply. */
export function applyArtifactEdits(
  base: string,
  edits: readonly ArtifactEdit[],
): string {
  let content = base;
  edits.forEach((edit, i) => {
    if (
      typeof edit.old_str !== "string" ||
      typeof edit.new_str !== "string" ||
      edit.old_str === ""
    ) {
      throw new Error(
        `edit_failed: edit ${i + 1} needs a non-empty old_str and a new_str.`,
      );
    }
    const at = findOnce(content, edit.old_str);
    if (at === "missing") {
      throw new Error(
        `edit_failed: edit ${i + 1} old_str not found in the latest version. Copy it verbatim, or resend the full content.`,
      );
    }
    if (at === "ambiguous") {
      throw new Error(
        `edit_failed: edit ${i + 1} old_str matches more than once. Include more surrounding text.`,
      );
    }
    content = content.slice(0, at.start) + edit.new_str + content.slice(at.end);
  });
  return content;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A previously sent version's fields, or null when the event is not one. */
export function readStoredArtifact(content: unknown): StoredArtifact | null {
  if (!content || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  if (typeof c.identifier !== "string" || typeof c.title !== "string")
    return null;
  if (!ARTIFACT_KINDS.includes(c.type as ArtifactKind)) return null;
  if (typeof c.body !== "string" && typeof c.url !== "string") return null;
  return c as unknown as StoredArtifact;
}
