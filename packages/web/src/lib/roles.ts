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

export function roleForLevel(level: number): Role {
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
