import { EventType, type Room, type RoomMember, RoomStateEvent } from "matrix-js-sdk";
import { useMemo, useSyncExternalStore } from "react";
import { MatrixClientPeg } from "../client/peg";
import { ADMIN_LEVEL, MANAGER_LEVEL, OWNER_LEVEL, type Role, roleForLevel, userLevel } from "../lib/roles";
import { subscribeRoomState } from "./matrix-subscriptions";
import { useSpaceMembers } from "./use-space-members";

export interface MemberRole {
  userId: string;
  displayName: string;
  powerLevel: number;
  role: Role;
}

export type MemberGroupKind = "owner" | "admin" | "manager" | "member" | "guest" | "agent";

export interface MemberRoleGroup {
  kind: MemberGroupKind;
  label: string;
  members: MemberRole[];
}

const HUMAN_GROUPS: { kind: Exclude<MemberGroupKind, "agent">; label: string }[] = [
  { kind: "owner", label: "Owners" },
  { kind: "admin", label: "Admins" },
  { kind: "manager", label: "Managers" },
  { kind: "member", label: "Members" },
  { kind: "guest", label: "Guests" },
];

export interface GroupOptions {
  isAgent?: (userId: string) => boolean;
  /** An agent's persona; agents sharing one read as one role (plan §6.1). */
  personaOf?: (userId: string) => string;
  /** Room members outside the room's project space. */
  guestIds?: ReadonlySet<string>;
}

// A custom level joins the highest standard role at or below it.
function rankGroup(level: number): "owner" | "admin" | "manager" | "member" {
  if (level >= OWNER_LEVEL) return "owner";
  if (level >= ADMIN_LEVEL) return "admin";
  if (level >= MANAGER_LEVEL) return "manager";
  return "member";
}

// Humans by role (Owners, Admins, Managers, Members, Guests), then one Agents
// group per persona. Each sorted by power level descending, then display
// name. Empty groups are omitted.
export function groupMembersByRole(members: MemberRole[], opts: GroupOptions = {}): MemberRoleGroup[] {
  const humans = new Map<MemberGroupKind, MemberRole[]>();
  const personas = new Map<string, MemberRole[]>();
  for (const m of members) {
    if (opts.isAgent?.(m.userId)) {
      const persona = opts.personaOf?.(m.userId) ?? m.displayName;
      personas.set(persona, [...(personas.get(persona) ?? []), m]);
      continue;
    }
    const kind = opts.guestIds?.has(m.userId) ? "guest" : rankGroup(m.powerLevel);
    humans.set(kind, [...(humans.get(kind) ?? []), m]);
  }
  const byRank = (a: MemberRole, b: MemberRole) =>
    b.powerLevel - a.powerLevel || a.displayName.localeCompare(b.displayName);
  const out: MemberRoleGroup[] = HUMAN_GROUPS.filter(({ kind }) => humans.has(kind)).map(
    ({ kind, label }) => ({ kind, label, members: humans.get(kind)!.sort(byRank) }),
  );
  for (const [persona, list] of [...personas].sort(([a], [b]) => a.localeCompare(b))) {
    out.push({ kind: "agent", label: `Agents · ${persona}`, members: list.sort(byRank) });
  }
  return out;
}

/** The room's project space: its `m.space.parent` (canonical first) that we have joined. */
export function projectSpaceId(room: Room | null): string | null {
  if (!room) return null;
  const client = MatrixClientPeg.safeGet();
  const parents = [...room.currentState.getStateEvents(EventType.SpaceParent)]
    .filter((ev) => Object.keys(ev.getContent()).length > 0)
    .sort((a, b) => Number(!!b.getContent().canonical) - Number(!!a.getContent().canonical));
  for (const ev of parents) {
    const id = ev.getStateKey();
    if (id && client?.getRoom(id)?.getMyMembership() === "join") return id;
  }
  return null;
}

/**
 * Room members who are not in the room's project space (plan §6.4 guest).
 * Falls back to `fallbackSpaceId` when the room names no joined parent.
 * Empty while the space's members are unknown.
 */
export function useGuestIds(roomId: string, fallbackSpaceId: string | null): ReadonlySet<string> {
  const members = useMemberRoles(roomId);
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId) ?? null;
  const spaceMembers = useSpaceMembers(projectSpaceId(room) ?? fallbackSpaceId);
  return useMemo(() => {
    if (spaceMembers.length === 0) return NO_GUESTS;
    const inSpace = new Set(spaceMembers.map((m) => m.userId));
    return new Set(members.filter((m) => !inSpace.has(m.userId)).map((m) => m.userId));
  }, [members, spaceMembers]);
}

const NO_GUESTS: ReadonlySet<string> = new Set();

const EMPTY: MemberRole[] = [];

interface CacheEntry {
  members: RoomMember[];
  plEvent: unknown;
  result: MemberRole[];
}
const cache = new WeakMap<Room, CacheEntry>();

function snapshot(roomId: string): MemberRole[] {
  const room = MatrixClientPeg.safeGet()?.getRoom(roomId);
  if (!room) return EMPTY;

  // getJoinedMembers() returns a fresh array each call; compare element-wise
  // (RoomMember references are stable) so useSyncExternalStore sees a stable
  // snapshot and doesn't loop.
  const members = room.getJoinedMembers();
  const plEvent = room.currentState.getStateEvents(EventType.RoomPowerLevels, "") ?? null;

  const cached = cache.get(room);
  if (
    cached &&
    cached.plEvent === plEvent &&
    cached.members.length === members.length &&
    cached.members.every((m, i) => m === members[i])
  ) {
    return cached.result;
  }

  const pl = (plEvent?.getContent() ?? {}) as {
    users?: Record<string, number>;
    users_default?: number;
  };
  const result: MemberRole[] = members.map((m) => {
    const powerLevel = userLevel(room, m.userId, pl);
    return {
      userId: m.userId,
      displayName: m.name,
      powerLevel,
      role: roleForLevel(powerLevel),
    };
  });

  cache.set(room, { members, plEvent, result });
  return result;
}

export function useMemberRoles(roomId: string): MemberRole[] {
  return useSyncExternalStore(
    // Members change AND power_levels (a state event) change the result.
    (cb) => subscribeRoomState(roomId, [RoomStateEvent.Members, RoomStateEvent.Events], cb),
    () => snapshot(roomId),
    () => EMPTY,
  );
}
