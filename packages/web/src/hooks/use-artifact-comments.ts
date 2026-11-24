import { useMemo } from "react";
import { MatrixClientPeg } from "@/client/peg";
import { type ArtifactComment, artifactComments, sourceHas } from "@/lib/artifacts/comments";
import { toActor } from "@/model/from-matrix";
import type { ArtifactKind } from "@/model/types";
import type { ThreadEntriesState } from "./use-timeline-entries";
import { useWorkforce } from "./use-workforce";

/**
 * The thread's open comments on one artifact (spec §6.6). `latest` is the artifact's latest
 * version: a comment made on an older one whose target it no longer has is resolved.
 */
export function useArtifactComments(
  roomId: string,
  { root, replies }: Pick<ThreadEntriesState, "root" | "replies">,
  workforceSpaceId: string | null,
  identifier: string | undefined,
  latest: { eventId: string; kind: ArtifactKind; text: string | null } | undefined,
): ArtifactComment[] {
  const roster = useWorkforce(workforceSpaceId ?? "");
  const kind = latest?.kind;
  const text = latest?.text ?? null;
  const has = useMemo(() => (kind && text !== null ? sourceHas(kind, text) : null), [kind, text]);
  const eventId = latest?.eventId;
  return useMemo(() => {
    if (!identifier) return [];
    const room = MatrixClientPeg.safeGet()?.getRoom(roomId) ?? null;
    const isHuman = (id: string) => toActor(id, room, roster).kind === "human";
    return artifactComments(
      root ? [root, ...replies] : replies,
      identifier,
      isHuman,
      eventId && has ? { eventId, has } : undefined,
    );
  }, [roomId, root, replies, roster, identifier, eventId, has]);
}
