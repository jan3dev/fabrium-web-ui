import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeClient, makeRoom, mkMatrixEvent } from "../../test/factories";
import { MatrixClientPeg } from "../client/peg";
import { roleForLevel } from "../lib/roles";
import { type MemberRole, groupMembersByRole, useGuestIds, useMemberRoles } from "./use-member-roles";

const me = "@me:h.example";
const roomId = "!r:h.example";

function makeMembership(rid: string, userId: string) {
  return mkMatrixEvent({
    roomId: rid,
    sender: userId,
    type: "m.room.member",
    stateKey: userId,
    content: { membership: "join" },
  });
}

function setupRoom(powerLevels: Record<string, number>, usersDefault = 0) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me, powerLevels, usersDefault });
  room.currentState.setStateEvents(
    Object.keys(powerLevels).map((uid) => makeMembership(roomId, uid)),
  );
  (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
  MatrixClientPeg.injectClientForTest(client);
  return { client, room };
}

afterEach(() => MatrixClientPeg.reset());

describe("useMemberRoles", () => {
  it("joins each member to its explicit power level and role", () => {
    setupRoom({ [me]: 100, "@mgr:h.example": 50, "@bob:h.example": 0 });
    const { result } = renderHook(() => useMemberRoles(roomId));
    const byId = Object.fromEntries(result.current.map((m) => [m.userId, m]));
    expect(byId[me].powerLevel).toBe(100);
    expect(byId[me].role.kind).toBe("owner");
    expect(byId["@mgr:h.example"].role.kind).toBe("manager");
    expect(byId["@bob:h.example"].role.kind).toBe("member");
  });

  it("falls back to users_default for members absent from the users map", () => {
    const client = makeFakeClient({ userId: me });
    const room = makeRoom(roomId, {
      client,
      myUserId: me,
      powerLevels: { [me]: 100 },
      usersDefault: 0,
    });
    room.currentState.setStateEvents([
      makeMembership(roomId, me),
      makeMembership(roomId, "@bob:h.example"),
    ]);
    (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
    MatrixClientPeg.injectClientForTest(client);

    const { result } = renderHook(() => useMemberRoles(roomId));
    const bob = result.current.find((m) => m.userId === "@bob:h.example");
    expect(bob?.powerLevel).toBe(0);
    expect(bob?.role.kind).toBe("member");
  });

  it("preserves non-standard levels as custom roles", () => {
    setupRoom({ [me]: 100, "@odd:h.example": 25 });
    const { result } = renderHook(() => useMemberRoles(roomId));
    const odd = result.current.find((m) => m.userId === "@odd:h.example");
    expect(odd?.powerLevel).toBe(25);
    expect(odd?.role.kind).toBe("custom");
  });
});

function member(userId: string, powerLevel: number): MemberRole {
  return { userId, displayName: userId, powerLevel, role: roleForLevel(powerLevel) };
}

describe("groupMembersByRole", () => {
  it("groups people by role, owners first", () => {
    const groups = groupMembersByRole([
      member("@bob:h", 0),
      member("@owner:h", 100),
      member("@admin:h", 90),
      member("@mgr:h", 50),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Owners", "Admins", "Managers", "Members"]);
  });

  it("puts a custom level with the highest role at or below it, sorted by power desc", () => {
    const groups = groupMembersByRole([member("@def:h", 0), member("@custom:h", 25), member("@high:h", 75)]);
    expect(groups.map((g) => g.kind)).toEqual(["manager", "member"]);
    expect(groups[1].members.map((m) => m.userId)).toEqual(["@custom:h", "@def:h"]);
  });

  it("puts guests after members and agents last, one group per persona", () => {
    const agents: Record<string, string> = { "@qa1:h": "QA", "@qa2:h": "QA", "@coder:h": "Coder" };
    const groups = groupMembersByRole(
      [member("@bob:h", 0), member("@guest:h", 0), member("@qa1:h", 0), member("@coder:h", 0), member("@qa2:h", 0)],
      { isAgent: (id) => id in agents, personaOf: (id) => agents[id]!, guestIds: new Set(["@guest:h"]) },
    );
    expect(groups.map((g) => g.label)).toEqual(["Members", "Guests", "Agents · Coder", "Agents · QA"]);
    expect(groups[3].members.map((m) => m.userId)).toEqual(["@qa1:h", "@qa2:h"]);
  });

  it("omits empty groups", () => {
    const groups = groupMembersByRole([member("@owner:h", 100)]);
    expect(groups.map((g) => g.kind)).toEqual(["owner"]);
  });
});

describe("useGuestIds", () => {
  const projectId = "!project:h.example";
  const workforceId = "!workforce:h.example";

  function setupGuests(opts: { parent: boolean }) {
    const client = makeFakeClient({ userId: me });
    const room = makeRoom(roomId, { client, myUserId: me });
    room.currentState.setStateEvents(
      [me, "@bob:h.example", "@guest:h.example"].map((uid) => makeMembership(roomId, uid)),
    );
    if (opts.parent) {
      room.currentState.setStateEvents([
        mkMatrixEvent({
          roomId,
          sender: me,
          type: "m.space.parent",
          stateKey: projectId,
          content: { via: ["h.example"], canonical: true },
        }),
      ]);
    }
    const space = (id: string, members: string[]) => {
      const s = makeRoom(id, { client, myUserId: me });
      s.currentState.setStateEvents(members.map((uid) => makeMembership(id, uid)));
      s.updateMyMembership("join");
      return s;
    };
    const rooms: Record<string, unknown> = {
      [roomId]: room,
      [projectId]: space(projectId, [me, "@bob:h.example"]),
      [workforceId]: space(workforceId, [me, "@bob:h.example", "@guest:h.example"]),
    };
    (client as unknown as { getRoom: (id: string) => unknown }).getRoom = (id) => rooms[id] ?? null;
    MatrixClientPeg.injectClientForTest(client);
  }

  it("marks room members outside the room's parent space as guests", () => {
    setupGuests({ parent: true });
    const { result } = renderHook(() => useGuestIds(roomId, workforceId));
    expect([...result.current]).toEqual(["@guest:h.example"]);
  });

  it("falls back to the given space when the room names no parent", () => {
    setupGuests({ parent: false });
    const { result } = renderHook(() => useGuestIds(roomId, workforceId));
    expect(result.current.size).toBe(0);
  });

  it("has no guests while the space is unknown", () => {
    setupGuests({ parent: false });
    const { result } = renderHook(() => useGuestIds(roomId, "!unknown:h.example"));
    expect(result.current.size).toBe(0);
  });
});
