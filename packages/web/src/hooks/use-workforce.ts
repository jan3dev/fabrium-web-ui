import { type Room, RoomStateEvent } from "matrix-js-sdk";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";
import { subscribeRoomState } from "./matrix-subscriptions";
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
    // Shared, refcounted room-state fan-out: many components read the roster.
    (cb) => subscribeRoomState(spaceId, [RoomStateEvent.Events], cb),
    () => snapshot(spaceId),
    () => EMPTY,
  );
}

export interface KnownAgent {
  agent: RosterAgent;
  /** Name of the workforce space whose roster lists the agent. */
  spaceName: string | undefined;
}

/**
 * The configured workforce space, provided by the logged-in view. Only its
 * roster says who is an agent: any other space's roster is written by whoever
 * created that space and could dress a human up as an agent.
 */
export const WorkforceSpaceContext = createContext<string | null>(null);

/**
 * The workforce roster entry for `userId`, or undefined for a non-agent. For
 * components with no workforce space at hand (avatars, the profile popover).
 */
export function useKnownAgent(userId: string): KnownAgent | undefined {
  const roster = useWorkforce(useContext(WorkforceSpaceContext) ?? "");
  const agent = roster.agent(userId);
  return useMemo(() => (agent ? { agent, spaceName: roster.spaceName } : undefined), [agent, roster.spaceName]);
}
