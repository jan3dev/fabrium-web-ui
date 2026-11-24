import { createHash } from "node:crypto";
import {
  ARTIFACT_KINDS,
  type ArtifactEdit,
  type ArtifactInput,
  type ArtifactKind,
} from "@zooid/core";
import type { MatrixClient } from "./matrix-client.js";
import { mimeFromFilename } from "./mime.js";

/** One version of an artifact; the web client folds them by thread + identifier. */
export const ARTIFACT_EVENT_TYPE = "dev.fabrium.artifact.version";
/** Matrix events max out at 64 KB; bigger bodies go to the media repo (plan §5). */
export const MAX_INLINE_ARTIFACT_BYTES = 48_000;
export const MAX_ARTIFACT_BYTES = 512_000;
/** Pages of thread relations searched for an artifact's latest version. */
export const ARTIFACT_SEARCH_PAGES = 10;
/** Assets per call and distinct `mxc://` URIs per version (spec §5.4). */
export const MAX_ARTIFACT_ASSETS = 100;
const IMAGE = 10_000_000;
const VIDEO = 50_000_000;
const FONT = 2_000_000;
/** Asset files the preview can load, by extension: size cap (spec §5.4); the type comes from `mimeFromFilename`. */
const ASSET_MAX: Record<string, number> = {
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  webp: IMAGE,
  avif: IMAGE,
  svg: IMAGE,
  mp4: VIDEO,
  webm: VIDEO,
  woff2: FONT,
  woff: FONT,
  ttf: FONT,
  otf: FONT,
};

/** Content type and size cap of an asset path, or a model-facing error. */
export function assetType(path: string): { mime: string; max: number } {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  const max = Object.hasOwn(ASSET_MAX, ext) ? ASSET_MAX[ext] : undefined;
  if (!max) {
    throw new Error(`invalid_asset: ${path}: use ${Object.keys(ASSET_MAX).join(", ")}.`);
  }
  return { mime: mimeFromFilename(path), max };
}

export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
/** As the web reader's `isMxc` (`web/src/lib/artifacts/assets.ts`). */
export const MXC = /^mxc:\/\/[A-Za-z0-9.:[\]-]{1,255}\/[A-Za-z0-9_-]{1,255}$/;

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
  // `read` and `assets` send nothing, so they take nothing else.
  const mode = input.read === true ? "read" : input.assets !== undefined ? "assets" : undefined;
  if (mode) {
    const extra = (["type", "title", "language", "content", "edits", "assets"] as const).filter(
      (key) => key !== mode && input[key] !== undefined,
    );
    if (extra.length > 0) {
      throw new Error(
        `invalid_input: \`${mode}\` takes only \`identifier\`; drop ${extra.map((k) => `\`${k}\``).join(", ")}, or drop \`${mode}\` to send a version.`,
      );
    }
    if (
      mode === "assets" &&
      (!Array.isArray(input.assets) ||
        input.assets.length === 0 ||
        input.assets.length > MAX_ARTIFACT_ASSETS ||
        !input.assets.every((p) => typeof p === "string" && p !== ""))
    ) {
      throw new Error(`invalid_input: \`assets\` is a list of 1 to ${MAX_ARTIFACT_ASSETS} file paths.`);
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
  const assets = new Set(content.match(/mxc:\/\/[^\s"'()<>]+/g));
  if (assets.size > MAX_ARTIFACT_ASSETS) {
    throw new Error(`invalid_content: ${assets.size} mxc:// assets, the limit is ${MAX_ARTIFACT_ASSETS} per artifact.`);
  }
  // Sections inside <template> (slide layouts) are not frames.
  if (
    (type === "slides" || type === "design" || type === "motion") &&
    !/<section[\s>]/i.test(content.replace(/<template[\s>][\s\S]*?<\/template>/gi, ""))
  ) {
    const unit = type === "slides" ? "slide" : type === "motion" ? "scene" : "screen";
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
        'invalid_content: a "design-system" artifact is one JSON object with any of: overview, colors, themes, spacing, typography, fonts, radius, shadows, layout, components, icons, logos, assets.',
      );
    }
  }
  if (type === "whiteboard") validateWhiteboard(content);
}

const WB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WB_TYPES = ["note", "text", "shape", "section", "image", "video"];
const WB_SHAPES = ["rectangle", "oval", "diamond"];
const WB_COLORS = ["yellow", "orange", "red", "pink", "purple", "blue", "green", "gray"];
const WB_ARROWS = ["none", "end", "both"];
const WB_LINE_STYLES = ["solid", "dashed", "dotted"];

/**
 * Design modes §6.10: `{ nodes, edges }`, all strings plain text. The web reader clamps and
 * drops; the agent gets told what to fix instead.
 */
function validateWhiteboard(content: string): void {
  const fail = (why: string): never => {
    throw new Error(`invalid_content: whiteboard ${why}`);
  };
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    fail('is one JSON object {"nodes": [...], "edges": [...]}; this is not JSON.');
  }
  const { nodes, edges = [] } = record(doc);
  if (!Array.isArray(nodes)) fail('is one JSON object {"nodes": [...], "edges": [...]}; `nodes` must be a list.');
  if (!Array.isArray(edges)) fail("`edges` must be a list.");
  const n = nodes as unknown[];
  const e = edges as unknown[];
  if (n.length > 500) fail(`has ${n.length} nodes, the limit is 500.`);
  if (e.length > 1000) fail(`has ${e.length} edges, the limit is 1000.`);
  const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const oneOf = (v: unknown, list: string[]) => v === undefined || list.includes(v as string);
  const ids = new Set<string>();
  n.forEach((raw, i) => {
    const node = record(raw);
    const at = `node ${i + 1}${typeof node.id === "string" ? ` ("${node.id.slice(0, 64)}")` : ""}`;
    if (typeof node.id !== "string" || !WB_ID.test(node.id)) fail(`${at}: \`id\` is 1-64 of A-Z a-z 0-9 _ -.`);
    if (ids.has(node.id as string)) fail(`${at}: duplicate id; every node id is unique.`);
    ids.add(node.id as string);
    if (!WB_TYPES.includes(node.type as string)) fail(`${at}: \`type\` is one of ${WB_TYPES.join(", ")}.`);
    if (!num(node.x, -100000, 100000) || !num(node.y, -100000, 100000)) fail(`${at}: \`x\` and \`y\` are numbers within ±100000.`);
    if (!num(node.w, 8, 10000) || !num(node.h, 8, 10000)) fail(`${at}: \`w\` and \`h\` are numbers from 8 to 10000.`);
    if (node.text !== undefined && (typeof node.text !== "string" || node.text.length > 2000)) fail(`${at}: \`text\` is plain text up to 2000 characters.`);
    if (!oneOf(node.color, WB_COLORS)) fail(`${at}: \`color\` is one of ${WB_COLORS.join(", ")}.`);
    if (!oneOf(node.shape, WB_SHAPES)) fail(`${at}: \`shape\` is one of ${WB_SHAPES.join(", ")}.`);
    if (node.mxc !== undefined && (typeof node.mxc !== "string" || !MXC.test(node.mxc))) fail(`${at}: \`mxc\` is an mxc:// URI from \`assets\`.`);
  });
  e.forEach((raw, i) => {
    const edge = record(raw);
    if (!ids.has(edge.from as string) || !ids.has(edge.to as string)) fail(`edge ${i + 1}: \`from\` and \`to\` must be node ids.`);
    if (edge.label !== undefined && (typeof edge.label !== "string" || edge.label.length > 200)) fail(`edge ${i + 1}: \`label\` is plain text up to 200 characters.`);
    if (!oneOf(edge.arrow, WB_ARROWS)) fail(`edge ${i + 1}: \`arrow\` is one of ${WB_ARROWS.join(", ")}.`);
    if (!oneOf(edge.style, WB_LINE_STYLES)) fail(`edge ${i + 1}: \`style\` is one of ${WB_LINE_STYLES.join(", ")} (default solid).`);
    if (!oneOf(edge.color, WB_COLORS)) fail(`edge ${i + 1}: \`color\` is one of ${WB_COLORS.join(", ")}; leave it out for the neutral line.`);
    // Last, as the reader drops it: an edge from a node to itself is not drawn.
    if (edge.from === edge.to) fail(`edge ${i + 1}: \`from\` and \`to\` must be two different nodes.`);
  });
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

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

/** The room's project spaces: its non-empty `m.space.parent` state keys, canonical first. */
export function projectSpaceParents(state: RoomState): string[] {
  return state
    .filter((e) => e.type === "m.space.parent" && e.state_key && Object.keys(record(e.content)).length > 0)
    .sort((a, b) => Number(!!record(b.content).canonical) - Number(!!record(a.content).canonical))
    .map((e) => e.state_key!);
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
  let spaceMembers: Set<string> | null = null;
  for (const parent of projectSpaceParents(state)) {
    try {
      spaceMembers = new Set(Object.keys((await client.getJoinedMembers(parent, asUserId)).joined));
      break;
    } catch {
      // A space this agent cannot read cannot prove anyone a guest: try the next, else allow.
    }
  }
  return (sender) => canAuthorArtifact(state, sender, isAgent(sender) ? null : spaceMembers);
}

/** Design modes §6.8: the message field the composer's Create menu and `/slides`-style commands set. */
export const ARTIFACT_HINT_FIELD = "dev.fabrium.artifact_hint";

/**
 * The per-turn line for an artifact hint on the message that started the turn, or null.
 * Only the five known types pass.
 */
export function artifactHintLine(content: unknown): string | null {
  const type = record(record(content)[ARTIFACT_HINT_FIELD]).type;
  if (["slides", "design", "design-system", "whiteboard", "motion"].includes(type as string))
    return `The user chose "${type}" in the composer: answer with a zooid_artifact of type "${type}" (or update this thread's ${type} artifact).`;
  return null;
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
