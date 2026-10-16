import type { MatrixEvent } from "matrix-js-sdk";
import { parseMxc } from "@/lib/matrix/authed-media";
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactVersion } from "@/model/types";

/** One version of an artifact, sent by the daemon's `zooid_artifact` tool. */
export const ArtifactEventType = "dev.fabrium.artifact.version";

export type DecodedArtifact = Pick<
  ArtifactVersion,
  "identifier" | "kind" | "title" | "language" | "body" | "mxc" | "sha256"
>;

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
  };
}
