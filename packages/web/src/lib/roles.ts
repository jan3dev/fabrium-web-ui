// Fabrium roles on Matrix power levels (plan §6.4). Guest is not a level: it is
// a room member who is not in the room's project space (see use-member-roles).
export const OWNER_LEVEL = 100;
export const ADMIN_LEVEL = 90;
export const MANAGER_LEVEL = 50;
export const MEMBER_LEVEL = 0;

export type StandardRoleKind = "owner" | "admin" | "manager" | "member";
export type RoleKind = StandardRoleKind | "custom";

export interface Role {
  kind: RoleKind;
  level: number;
}

const LEVELS: Record<StandardRoleKind, number> = {
  owner: OWNER_LEVEL,
  admin: ADMIN_LEVEL,
  manager: MANAGER_LEVEL,
  member: MEMBER_LEVEL,
};

const LABELS: Record<StandardRoleKind, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

const STANDARD = Object.keys(LEVELS) as StandardRoleKind[];

/**
 * A room creator's level from room version 12 on: the create event's sender
 * and `additional_creators` outrank every power level and may not be listed in
 * `users`.
 */
export const CREATOR_LEVEL = Infinity;

interface PowerLevelsContent {
  users?: Record<string, number>;
  users_default?: number;
}

interface RoomState {
  currentState: {
    getStateEvents(
      type: string,
      stateKey: string,
    ): {
      getSender(): string | undefined;
      getContent(): Record<string, unknown>;
    } | null;
  };
}

export function isRoomCreator(room: RoomState, userId: string): boolean {
  const create = room.currentState.getStateEvents("m.room.create", "");
  if (!create) return false;
  const c = create.getContent() as {
    room_version?: unknown;
    additional_creators?: unknown;
  };
  // Versions are strings; only the numbered ones from 12 up have privileged creators.
  if (!(Number(c.room_version ?? "1") >= 12)) return false;
  return (
    create.getSender() === userId ||
    (Array.isArray(c.additional_creators) &&
      c.additional_creators.includes(userId))
  );
}

/** `userId`'s power level in `room`, room creators included. */
export function userLevel(
  room: RoomState,
  userId: string,
  pl: PowerLevelsContent,
): number {
  if (isRoomCreator(room, userId)) return CREATOR_LEVEL;
  return pl.users?.[userId] ?? pl.users_default ?? 0;
}

export function roleForLevel(level: number): Role {
  if (level === CREATOR_LEVEL) return { kind: "owner", level };
  const kind = STANDARD.find((k) => LEVELS[k] === level);
  return { kind: kind ?? "custom", level };
}

export function roleLabel(role: Role): string {
  return role.kind === "custom" ? `Custom (${role.level})` : LABELS[role.kind];
}

export function levelForRole(kind: StandardRoleKind): number {
  return LEVELS[kind];
}

export interface RoleOption {
  kind: StandardRoleKind;
  level: number;
  label: string;
  disabled: boolean;
}

// The standard roles in descending order. When `viewerLevel` is given, any
// option above it is disabled (Rule 9: cannot grant above your own level).
export function standardRoleOptions(viewerLevel = Infinity): RoleOption[] {
  return STANDARD.map((kind) => ({
    kind,
    level: LEVELS[kind],
    label: LABELS[kind],
    disabled: LEVELS[kind] > viewerLevel,
  }));
}
