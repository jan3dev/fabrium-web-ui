import { createHash } from "node:crypto";
import {
  ARTIFACT_KINDS,
  type ArtifactEdit,
  type ArtifactInput,
  type ArtifactKind,
} from "@zooid/core";
import type { MatrixClient } from "./matrix-client.js";

/** One version of an artifact; the web client folds them by thread + identifier. */
export const ARTIFACT_EVENT_TYPE = "dev.fabrium.artifact.version";
/** Matrix events max out at 64 KB; bigger bodies go to the media repo (plan §5). */
export const MAX_INLINE_ARTIFACT_BYTES = 48_000;
export const MAX_ARTIFACT_BYTES = 512_000;
/** Pages of thread relations searched for an artifact's latest version. */
export const ARTIFACT_SEARCH_PAGES = 10;

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
  if (input.read === true) {
    const extra = (["type", "title", "language", "content", "edits"] as const).filter(
      (key) => input[key] !== undefined,
    );
    if (extra.length > 0) {
      throw new Error(
        `invalid_input: \`read\` takes only \`identifier\`; drop ${extra.map((k) => `\`${k}\``).join(", ")}, or drop \`read\` to send a version.`,
      );
    }
    return;
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

/**
 * Checks the final content (after `edits`) of the kinds whose panel mode
 * needs a structure; the web reader re-checks the details. Throws for the model.
 */
export function validateArtifactContent(type: ArtifactKind, content: string): void {
  // Sections inside <template> (slide layouts) are not frames.
  if (
    (type === "slides" || type === "design") &&
    !/<section[\s>]/i.test(content.replace(/<template[\s>][\s\S]*?<\/template>/gi, ""))
  ) {
    const unit = type === "slides" ? "slide" : "screen";
    throw new Error(
      `invalid_content: a "${type}" artifact needs one <section> per ${unit} as direct children of <body>.`,
    );
  }
  if (type === "design-system") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        'invalid_content: a "design-system" artifact is one JSON object with any of: overview, colors, spacing, typography, radius, shadows, components, assets.',
      );
    }
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
        `edit_failed: edit ${i + 1} old_str not found in the latest version; the user may have edited it. Call read, then copy each old_str verbatim from what it returns. Send full content only for a large change, built on what read returns.`,
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

/**
 * A previously sent version's fields, or null when the event is not one.
 * Any room member may have sent it: every field is type-checked and copied.
 */
export function readStoredArtifact(content: unknown): StoredArtifact | null {
  if (!content || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  if (typeof c.identifier !== "string" || typeof c.title !== "string")
    return null;
  if (!ARTIFACT_KINDS.includes(c.type as ArtifactKind)) return null;
  const stored: StoredArtifact = {
    identifier: c.identifier,
    type: c.type as ArtifactKind,
    title: c.title.slice(0, 200),
  };
  if (typeof c.language === "string" && c.language.length <= 40) stored.language = c.language;
  if (typeof c.body === "string") stored.body = c.body;
  else if (typeof c.url === "string") {
    stored.url = c.url;
    if (typeof c.sha256 === "string" && /^[0-9a-f]{64}$/.test(c.sha256)) stored.sha256 = c.sha256;
  } else return null;
  return stored;
}

/** The state events `canAuthorArtifact` reads, as `/state` returns them. */
export type RoomState = Array<{ type?: string; state_key?: string; sender?: string; content?: unknown }>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Who may write a version (decision D2), the same rule as the web client: a
 * joined member, not a guest (absent from `spaceMembers`, the joined members
 * of the room's project space; null = no guest rule), whose power level
 * reaches the level for sending `dev.fabrium.artifact.version`
 * (`events[type]`, else `events_default`). From room version 12 the room's
 * creators outrank every level. Reads the current state, not the state when
 * the version was sent.
 */
export function canAuthorArtifact(
  state: RoomState,
  sender: string,
  spaceMembers: ReadonlySet<string> | null = null,
): boolean {
  const find = (type: string, key: string) =>
    state.find((e) => e.type === type && e.state_key === key);
  if (record(find("m.room.member", sender)?.content).membership !== "join") return false;
  if (spaceMembers && !spaceMembers.has(sender)) return false;
  const create = find("m.room.create", "");
  const createContent = record(create?.content);
  if (Number(createContent.room_version ?? "1") >= 12) {
    const extra = createContent.additional_creators;
    if (create?.sender === sender || (Array.isArray(extra) && extra.includes(sender))) return true;
  }
  const power = find("m.room.power_levels", "");
  // No power levels: every member may send any message event.
  if (!power) return true;
  const pl = record(power.content);
  const level = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const user = level(record(pl.users)[sender], level(pl.users_default, 0));
  const needed = level(record(pl.events)[ARTIFACT_EVENT_TYPE], level(pl.events_default, 0));
  return user >= needed;
}

/**
 * `canAuthorArtifact` for one room: reads its state and, for the guest rule,
 * the joined members of its project space, as the web's `useGuestIds` does:
 * the first `m.space.parent` (canonical first) whose members this agent can
 * read. No such parent = no guest concept, so nobody is excluded as a guest.
 */
export async function artifactAuthorCheck(
  client: Pick<MatrixClient, "fetchRoomState" | "getJoinedMembers">,
  roomId: string,
  asUserId: string,
  /** Agents are never guests, as on the web: the guest rule is for humans. */
  isAgent: (sender: string) => boolean = () => false,
): Promise<(sender: string) => boolean> {
  const state = await client.fetchRoomState(roomId, asUserId);
  const parents = state
    .filter((e) => e.type === "m.space.parent" && e.state_key && Object.keys(record(e.content)).length > 0)
    .sort((a, b) => Number(!!record(b.content).canonical) - Number(!!record(a.content).canonical));
  let spaceMembers: Set<string> | null = null;
  for (const parent of parents) {
    try {
      spaceMembers = new Set(Object.keys((await client.getJoinedMembers(parent.state_key!, asUserId)).joined));
      break;
    } catch {
      // A space this agent cannot read cannot prove anyone a guest: try the next, else allow.
    }
  }
  return (sender) => canAuthorArtifact(state, sender, isAgent(sender) ? null : spaceMembers);
}

const SUMMARY_MAX = 120;
const LINE_BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;

/**
 * The per-turn notice that a human changed an artifact. `summary` is free text
 * from a room member: first line only, no control or format characters, no
 * backticks, clamped. The identifier is checked against the tool's own rule.
 */
export function userEditedLine(identifier: string, summary: unknown): string | null {
  if (!IDENTIFIER.test(identifier)) return null;
  const text =
    typeof summary === "string"
      ? (summary
          .split(LINE_BREAK)
          .find((line) => line.trim() !== "") ?? "")
          .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}`]/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  const chars = Array.from(text);
  const clamped = chars.length > SUMMARY_MAX ? `${chars.slice(0, SUMMARY_MAX).join("")}…` : text;
  return `The user edited artifact \`${identifier}\`: ${clamped || "no summary given"}`;
}

/**
 * Newest-first events of one type in a thread, `pages` pages of 50 at most.
 * Relations come in timeline order, so the first match is the latest.
 */
export async function* threadEventsNewestFirst(
  client: Pick<MatrixClient, "fetchThreadRelations">,
  opts: { roomId: string; threadId: string; asUserId: string; eventType: string; pages: number },
): AsyncGenerator<Record<string, unknown>> {
  let from: string | undefined;
  for (let page = 0; page < opts.pages; page++) {
    const { chunk, next_batch } = await client.fetchThreadRelations({
      roomId: opts.roomId,
      rootEventId: opts.threadId,
      asUserId: opts.asUserId,
      eventType: opts.eventType,
      dir: "b",
      limit: 50,
      from,
    });
    yield* chunk;
    if (!next_batch) return;
    from = next_batch;
  }
}

/**
 * One `userEditedLine` per artifact a human changed in this thread since the
 * agent's previous turn started (`started_ts` on its last `dev.zooid.turn.end`
 * there, else that event's own timestamp), newest first. A version sent while
 * that turn ran is reported again rather than missed. Nothing before the
 * agent's first turn in the thread: it has no stale picture.
 */
export async function userEditedArtifactLines(
  client: Pick<MatrixClient, "fetchThreadRelations" | "fetchRoomState" | "getJoinedMembers">,
  opts: { roomId: string; threadId: string; asUserId: string; isHuman: (userId: string) => boolean },
): Promise<string[]> {
  if (!opts.threadId.startsWith("$")) return [];
  const scan = (eventType: string, pages: number) =>
    threadEventsNewestFirst(client, { ...opts, eventType, pages });
  // ponytail: only the newest 50 versions are checked; page further if threads ever hold more between turns.
  const candidates: Array<{ ts: number; sender: string; identifier: string; summary: unknown }> = [];
  for await (const ev of scan(ARTIFACT_EVENT_TYPE, 1)) {
    const stored = readStoredArtifact(ev.content);
    if (!stored || typeof ev.sender !== "string" || typeof ev.origin_server_ts !== "number") continue;
    if (!opts.isHuman(ev.sender)) continue;
    candidates.push({ ts: ev.origin_server_ts, sender: ev.sender, identifier: stored.identifier, summary: record(ev.content).summary });
  }
  if (candidates.length === 0) return [];
  let cutoff: number | undefined;
  for await (const ev of scan("dev.zooid.turn.end", ARTIFACT_SEARCH_PAGES)) {
    if (ev.sender === opts.asUserId && typeof ev.origin_server_ts === "number") {
      const started = record(ev.content).started_ts;
      // A start after the turn's own end is bogus; older turn.ends have none.
      cutoff =
        typeof started === "number" && Number.isFinite(started) && started <= ev.origin_server_ts
          ? started
          : ev.origin_server_ts;
      break;
    }
  }
  if (cutoff === undefined) return [];
  // Same millisecond as the cutoff: report it; a repeated notice beats a missed one.
  const fresh = candidates.filter((c) => c.ts >= cutoff!);
  if (fresh.length === 0) return [];
  const allowed = await artifactAuthorCheck(client, opts.roomId, opts.asUserId);
  const lines = new Map<string, string>();
  for (const c of fresh) {
    if (lines.has(c.identifier) || !allowed(c.sender)) continue;
    const line = userEditedLine(c.identifier, c.summary);
    if (line) lines.set(c.identifier, line);
  }
  return [...lines.values()];
}
