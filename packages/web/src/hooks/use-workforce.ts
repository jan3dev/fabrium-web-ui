import { type Room, RoomStateEvent } from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";
import { makeAgentSet, parseWorkforceRoster, type RosterAgent } from "../lib/matrix/agent-detection";

export interface WorkforceView {
  ready: boolean;
  agents: RosterAgent[];
  isAgent: (userId: string) => boolean;
  agent: (userId: string) => RosterAgent | undefined;
  /** The workforce space's name. */
  spaceName: string | undefined;
}

const none = () => undefined;
const EMPTY: WorkforceView = { ready: false, agents: [], isAgent: () => false, agent: none, spaceName: undefined };
const cache = new WeakMap<Room, { key: string; view: WorkforceView }>();

function snapshot(spaceId: string): WorkforceView {
  const room = MatrixClientPeg.safeGet()?.getRoom(spaceId);
  if (!room) return EMPTY;
  const parsed = mergedRoster(room);
  const key = `${room.name}|${JSON.stringify(parsed)}`;
  const cached = cache.get(room);
  if (cached?.key === key) return cached.view;
  const byId = new Map((parsed ?? []).map((a) => [a.userId, a]));
  const set = makeAgentSet(parsed ?? []);
  const view: WorkforceView = {
    ready: parsed !== null,
    agents: parsed ?? [],
    isAgent: (id) => set.has(id),
    agent: (id) => byId.get(id),
    spaceName: room.name || undefined,
  };
  cache.set(room, { key, view });
  return view;
}

/**
 * Each daemon publishes its own roster under its workstation's state key, so
 * the workforce is the union of every `dev.zooid.workforce` event in the
 * space. Null until at least one roster parses.
 */
function mergedRoster(room: Room): RosterAgent[] | null {
  const events = [...room.currentState.getStateEvents("dev.zooid.workforce")].sort((a, b) =>
    (a.getStateKey() ?? "").localeCompare(b.getStateKey() ?? ""),
  );
  let out: RosterAgent[] | null = null;
  const seen = new Set<string>();
  for (const ev of events) {
    const parsed = parseWorkforceRoster(ev.getContent());
    if (!parsed) continue;
    out ??= [];
    for (const a of parsed) {
      if (seen.has(a.userId)) continue;
      seen.add(a.userId);
      out.push(a);
    }
  }
  return out;
}

export function useWorkforce(spaceId: string): WorkforceView {
  return useSyncExternalStore(
    (cb) => {
      const client = MatrixClientPeg.safeGet();
      const room = client?.getRoom(spaceId);
      if (!room) return MatrixClientPeg.subscribe(cb);
      const onState = () => cb();
      room.currentState.on(RoomStateEvent.Events, onState);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        room.currentState.off(RoomStateEvent.Events, onState);
        unsubPeg();
      };
    },
    () => snapshot(spaceId),
    () => EMPTY,
  );
}
