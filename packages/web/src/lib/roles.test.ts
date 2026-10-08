import { describe, expect, it } from "vitest";
import {
  ADMIN_LEVEL,
  MANAGER_LEVEL,
  MEMBER_LEVEL,
  OWNER_LEVEL,
  type Role,
  levelForRole,
  roleForLevel,
  roleLabel,
  standardRoleOptions,
} from "./roles";

describe("roleForLevel", () => {
  it("maps the standard ladder to named roles", () => {
    expect(roleForLevel(100)).toEqual<Role>({ kind: "owner", level: 100 });
    expect(roleForLevel(90)).toEqual<Role>({ kind: "admin", level: 90 });
    expect(roleForLevel(50)).toEqual<Role>({ kind: "manager", level: 50 });
    expect(roleForLevel(0)).toEqual<Role>({ kind: "member", level: 0 });
  });

  it("maps any non-standard value to a custom role preserving the level", () => {
    expect(roleForLevel(25)).toEqual<Role>({ kind: "custom", level: 25 });
    expect(roleForLevel(101)).toEqual<Role>({ kind: "custom", level: 101 });
  });
});

describe("roleLabel", () => {
  it("labels the standard roles", () => {
    expect(roleLabel(roleForLevel(100))).toBe("Owner");
    expect(roleLabel(roleForLevel(90))).toBe("Admin");
    expect(roleLabel(roleForLevel(50))).toBe("Manager");
    expect(roleLabel(roleForLevel(0))).toBe("Member");
  });

  it("renders Custom (N) for non-standard levels", () => {
    expect(roleLabel(roleForLevel(25))).toBe("Custom (25)");
  });
});

describe("levelForRole", () => {
  it("returns the canonical level for standard role kinds", () => {
    expect(levelForRole("owner")).toBe(OWNER_LEVEL);
    expect(levelForRole("admin")).toBe(ADMIN_LEVEL);
    expect(levelForRole("manager")).toBe(MANAGER_LEVEL);
    expect(levelForRole("member")).toBe(MEMBER_LEVEL);
  });
});

describe("standardRoleOptions", () => {
  it("returns owner/admin/manager/member in descending order", () => {
    expect(standardRoleOptions().map((o) => o.kind)).toEqual(["owner", "admin", "manager", "member"]);
  });

  it("disables options above a viewer's own level", () => {
    // viewer at 50 may grant manager/member, not owner or admin
    const opts = standardRoleOptions(50);
    expect(opts.filter((o) => o.disabled).map((o) => o.kind)).toEqual(["owner", "admin"]);
  });
});
