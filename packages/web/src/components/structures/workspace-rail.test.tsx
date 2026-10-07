import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationCountType, type Room } from "matrix-js-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  injectStateEvent,
  makeFakeClient,
  makeRoom,
  mkMatrixEvent,
} from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import type { Scope } from "./sidebar/scope";
import { WorkspaceRail, railIndicators } from "./workspace-rail";

const me = "@me:h.example";
const acme = "!acme:h.example";
const beta = "!beta:h.example";

afterEach(() => MatrixClientPeg.reset());

/** Two workspaces with one unread room each (acme: 3 unread, beta: 5 unread incl. 2 mentions) and a project inside acme. */
function seed() {
  const client = makeFakeClient({ userId: me });
  const rooms = new Map<string, Room>();
  const mk = (id: string, name: string, space: boolean) => {
    const room = makeRoom(id, { client, myUserId: me });
    Object.assign(room as unknown as Record<string, unknown>, {
      name,
      isSpaceRoom: () => space,
      getMyMembership: () => "join",
    });
    rooms.set(id, room);
    return room;
  };
  const link = (parent: Room, childId: string) =>
    injectStateEvent(
      parent,
      mkMatrixEvent({
        roomId: parent.roomId,
        sender: "@admin:h.example",
        type: "m.space.child",
        stateKey: childId,
        content: { via: ["h.example"] },
      }),
    );

  const acmeSpace = mk(acme, "Acme Corp", true);
  const betaSpace = mk(beta, "Beta", true);
  mk("!payments:h.example", "Payments", true);
  link(acmeSpace, "!payments:h.example");
  mk("!a1:h.example", "a1", false).setUnreadNotificationCount(
    NotificationCountType.Total,
    3,
  );
  link(acmeSpace, "!a1:h.example");
  const b1 = mk("!b1:h.example", "b1", false);
  b1.setUnreadNotificationCount(NotificationCountType.Total, 5);
  b1.setUnreadNotificationCount(NotificationCountType.Highlight, 2);
  link(betaSpace, "!b1:h.example");

  const cast = client as unknown as Record<string, unknown>;
  cast.getRoom = (id: string) => rooms.get(id) ?? null;
  cast.getRooms = () => Array.from(rooms.values());
  MatrixClientPeg.injectClientForTest(client);
}

function renderRail(scope: Scope, onSelect = vi.fn()) {
  render(<WorkspaceRail scope={scope} onSelect={onSelect} />);
  return onSelect;
}

describe("<WorkspaceRail>", () => {
  it("lists Home and each top-level workspace, not projects", () => {
    seed();
    renderRail({ kind: "home" });
    const nav = screen.getByRole("navigation", { name: "Workspaces" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /^Acme Corp/ }),
    ).toHaveTextContent("AC");
    expect(screen.getByRole("button", { name: /^Beta/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Payments/ })).toBeNull();
  });

  it("marks the active workspace and switches on click", async () => {
    seed();
    const onSelect = renderRail({ kind: "space", spaceId: acme });
    expect(screen.getByRole("button", { name: /^Acme Corp/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Beta/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "space", spaceId: beta });
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "home" });
  });

  it("badges mentions and dots plain unread", () => {
    seed();
    renderRail({ kind: "home" });
    expect(
      screen.getByRole("button", { name: "Beta, 2 mentions" }),
    ).toHaveTextContent("2");
    expect(
      screen.getByRole("button", { name: "Acme Corp, unread" }),
    ).toBeInTheDocument();
  });
});

describe("railIndicators", () => {
  it("never shows a dot and a badge together, and caps the badge", () => {
    expect(railIndicators({ total: 0, highlight: 0 })).toMatchObject({
      showBadge: false,
      showDot: false,
    });
    expect(railIndicators({ total: 4, highlight: 0 })).toMatchObject({
      showBadge: false,
      showDot: true,
    });
    expect(railIndicators({ total: 400, highlight: 120 })).toEqual({
      showBadge: true,
      showDot: false,
      badgeLabel: "99+",
    });
  });
});
