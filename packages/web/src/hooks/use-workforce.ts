import { type MatrixClient, type Room, RoomStateEvent } from "matrix-js-sdk";
import { useSyncExternalStore } from "react";
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

// Agents across every joined space's roster, rebuilt when a roster changes.
// Keyed by client so a new session never reads the last one's agents.
let knownAgents: { client: MatrixClient; byId: Map<string, KnownAgent> } | null = null;

function knownAgentMap(): Map<string, KnownAgent> | null {
  const client = MatrixClientPeg.safeGet();
  if (!client) return null;
  if (knownAgents?.client === client) return knownAgents.byId;
  const byId = new Map<string, KnownAgent>();
  for (const room of client.getRooms?.() ?? []) {
    if (!room.isSpaceRoom?.()) continue;
    for (const agent of mergedRoster(room) ?? []) {
      if (!byId.has(agent.userId)) byId.set(agent.userId, { agent, spaceName: room.name || undefined });
    }
  }
  knownAgents = { client, byId };
  return byId;
}

/**
 * The roster entry for `userId` from any joined workspace, or undefined for a
 * non-agent. For components with no workforce space at hand (avatars, the
 * profile popover).
 */
export function useKnownAgent(userId: string): KnownAgent | undefined {
  return useSyncExternalStore(subscribeKnownAgents, () => knownAgentMap()?.get(userId), () => undefined);
}

// One client listener for every avatar, not one each.
const knownAgentListeners = new Set<() => void>();
let detachKnownAgents: (() => void) | null = null;

function resetKnownAgents() {
  knownAgents = null;
  for (const l of knownAgentListeners) l();
}

function attachKnownAgents() {
  let client: MatrixClient | null = null;
  const onState = (ev: { getType(): string }) => {
    if (ev.getType() === "dev.zooid.workforce") resetKnownAgents();
  };
  const attachClient = () => {
    client?.off(RoomStateEvent.Events, onState);
    client = MatrixClientPeg.safeGet();
    client?.on(RoomStateEvent.Events, onState);
  };
  attachClient();
  // A new session: move the listener to its client.
  const unsubPeg = MatrixClientPeg.subscribe(() => {
    attachClient();
    resetKnownAgents();
  });
  detachKnownAgents = () => {
    client?.off(RoomStateEvent.Events, onState);
    unsubPeg();
  };
}

function subscribeKnownAgents(cb: () => void): () => void {
  knownAgentListeners.add(cb);
  if (!detachKnownAgents) attachKnownAgents();
  return () => {
    knownAgentListeners.delete(cb);
    if (knownAgentListeners.size === 0) {
      detachKnownAgents?.();
      detachKnownAgents = null;
    }
  };
}
