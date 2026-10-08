import { MatrixClientPeg } from "../client/peg";
import { toActor } from "../model/from-matrix";
import type { ActorSummary } from "../model/types";
import { useUserName } from "./use-user-name";
import { useKnownAgent } from "./use-workforce";

/** `userId` as an actor: agents labelled "Persona · Project" from the workforce roster, people by display name. */
export function useActor(userId: string, roomId?: string): ActorSummary {
  const known = useKnownAgent(userId);
  const name = useUserName(userId, roomId);
  const room = (roomId && MatrixClientPeg.safeGet()?.getRoom(roomId)) || null;
  const actor = toActor(userId, room, {
    isAgent: () => !!known,
    agent: () => known?.agent,
    spaceName: known?.spaceName,
  });
  return actor.kind === "agent" ? actor : { ...actor, displayName: name };
}
