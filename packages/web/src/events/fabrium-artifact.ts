import { EventType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { projectSpaceId } from "@/hooks/use-member-roles";
import { parseMxc } from "@/lib/matrix/authed-media";
import { userLevel } from "@/lib/roles";
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactVersion } from "@/model/types";

/** One version of an artifact, sent by the daemon's `zooid_artifact` tool or by a user (spec §5.2). */
export const ArtifactEventType = "dev.fabrium.artifact.version";

/** The daemon's limits (`transport-matrix/src/artifacts.ts`): inline up to 48 KB, else media, 512 KB at most. */
export const MAX_INLINE_ARTIFACT_BYTES = 48_000;
export const MAX_ARTIFACT_BYTES = 512_000;
const MAX_SUMMARY = 120;

export type DecodedArtifact = Pick<
  ArtifactVersion,
  "identifier" | "kind" | "title" | "language" | "body" | "mxc" | "sha256" | "summary"
> & {
  /** `based_on`: the event ID of the content this event was made from. */
  basedOn?: string;
};

/** Untrusted text → one line for the version list, or undefined. */
export function summaryLine(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // Control and format characters (bidi overrides) could make the list read differently.
  const line = raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY);
  return line || undefined;
}

export function decodeArtifactVersion(ev: MatrixEvent): DecodedArtifact | null {
  if (ev.getType() !== ArtifactEventType) return null;
  const c = ev.getContent() as Record<string, unknown>;
  if (typeof c.identifier !== "string" || !c.identifier) return null;
  if (!ARTIFACT_KINDS.includes(c.type as ArtifactKind)) return null;
  const body = typeof c.body === "string" ? c.body : undefined;
  const mxc =
    typeof c.url === "string" && parseMxc(c.url) ? c.url : undefined;
  const sha256 =
    typeof c.sha256 === "string" && /^[0-9a-f]{64}$/.test(c.sha256)
      ? c.sha256
      : undefined;
  // A media body is only trusted with its hash: the event pins the bytes.
  if (body === undefined && (!mxc || !sha256)) return null;
  return {
    identifier: c.identifier,
    kind: c.type as ArtifactKind,
    title: typeof c.title === "string" && c.title ? c.title : c.identifier,
    language:
      typeof c.language === "string" && c.language ? c.language : undefined,
    body,
    mxc: body === undefined ? mxc : undefined,
    sha256: body === undefined ? sha256 : undefined,
    basedOn: typeof c.based_on === "string" && /^\$\S{1,254}$/.test(c.based_on) ? c.based_on : undefined,
    summary: summaryLine(c.summary),
  };
}

/**
 * Who may author a version (spec D2): a joined member of the room whose power level
 * reaches the level for this event type (`events[type]`, else `events_default`), and,
 * for a human, who is not a guest (a member outside the room's project space, as the
 * member list groups them). Read from the room's current state. The same rule decides
 * whether the viewer sees edit controls.
 */
export function mayAuthorArtifact(room: Room | null, userId: string, isAgent: boolean): boolean {
  if (!room || room.getMember(userId)?.membership !== "join") return false;
  const pl = (room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ?? {}) as {
    users?: Record<string, number>;
    users_default?: number;
    events?: Record<string, number>;
    events_default?: number;
  };
  if (userLevel(room, userId, pl) < (pl.events?.[ArtifactEventType] ?? pl.events_default ?? 0)) return false;
  if (isAgent) return true;
  const spaceId = projectSpaceId(room);
  const space = spaceId ? room.client.getRoom(spaceId) : null;
  // Space members not known yet: nobody is a guest (as useGuestIds).
  if (!space || space.getJoinedMemberCount() === 0) return true;
  return space.getMember(userId)?.membership === "join";
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ArtifactVersionInput {
  identifier: string;
  kind: ArtifactKind;
  title: string;
  language?: string;
  text: string;
  basedOn?: string;
  summary?: string;
}

const kb = (n: number) => `${Math.ceil(n / 1000)} KB`;

/** Why `text` cannot be a version, or null. */
export function artifactSizeError(text: string): string | null {
  const size = new TextEncoder().encode(text).byteLength;
  return size > MAX_ARTIFACT_BYTES
    ? `This version would be ${kb(size)}. The limit is ${kb(MAX_ARTIFACT_BYTES)}. Undo the change, or ask the agent to split the artifact.`
    : null;
}

/**
 * Sends a version as the signed-in user, in the thread, with the daemon's body rules:
 * inline while the JSON-encoded body fits 48 KB, else authenticated media with
 * `sha256` and `size`. Throws a message for the user. Returns the event ID.
 */
export async function sendArtifactVersion(
  client: MatrixClient,
  roomId: string,
  threadRootId: string,
  v: ArtifactVersionInput,
): Promise<string> {
  const tooLarge = artifactSizeError(v.text);
  if (tooLarge) throw new Error(tooLarge);
  const content: Record<string, unknown> = { identifier: v.identifier, type: v.kind, title: v.title };
  if (v.language) content.language = v.language;
  const bytes = new TextEncoder().encode(v.text);
  // Measured as encoded in the event: JSON escaping can double quote- and newline-heavy markup.
  if (new TextEncoder().encode(JSON.stringify(v.text)).byteLength <= MAX_INLINE_ARTIFACT_BYTES) {
    content.body = v.text;
  } else {
    const type = "text/plain; charset=utf-8";
    const { content_uri } = await client.uploadContent(new Blob([bytes], { type }), {
      name: `${v.identifier}.txt`,
      type,
    });
    Object.assign(content, { url: content_uri, sha256: await sha256Hex(bytes), size: bytes.byteLength });
  }
  if (v.basedOn) content.based_on = v.basedOn;
  const summary = summaryLine(v.summary);
  if (summary) content.summary = summary;
  content["m.relates_to"] = { rel_type: "m.thread", event_id: threadRootId };
  const { event_id } = await client.sendEvent(roomId, threadRootId, ArtifactEventType as never, content as never);
  return event_id;
}
