import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../app";
import { MatrixClientPeg } from "../../client/peg";
import {
  mswServer,
  relaxUnhandled,
  stubStartClient,
  stubSyncWithRooms,
} from "../../../test/setup";

const HS = "https://h.example";
const me = "@alice:h.example";

/** The rail button marked as the current workspace. */
const activeWorkspace = () => {
  const el = document.querySelector(
    'nav[aria-label="Workspaces"] [aria-current="true"]',
  );
  return el?.getAttribute("aria-label") ?? "";
};

describe("<LoggedInView /> sidebar polish", () => {
  beforeEach(() => {
    relaxUnhandled();
    stubStartClient(HS);
    localStorage.setItem(
      "zoon:session",
      JSON.stringify({
        homeserverUrl: HS,
        accessToken: "tok",
        userId: me,
        deviceId: "DEV1",
      }),
    );
  });
  afterEach(() => {
    MatrixClientPeg.reset();
    localStorage.clear();
  });

  it("renders the workspace rail, top bar and sidebar", async () => {
    render(<App config={{ homeserverUrl: HS }} />);
    await waitFor(() =>
      expect(screen.getByTestId("logged-in-view")).toBeInTheDocument(),
    );
    expect(document.querySelector('[data-slot="sidebar"]')).not.toBeNull();
    expect(screen.getByTestId("top-bar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /user menu/i }),
    ).toBeInTheDocument();
    // The minimal sync stub doesn't seed the workforce space, so scope falls
    // back to Home.
    expect(activeWorkspace()).toBe("Home");
  });

  it("auto-selects the sole joined space when the workforce space doesn't resolve", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId: "!ops:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.create",
            sender: me,
            stateKey: "",
            content: { type: "m.space" },
          },
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "Ops" },
          },
        ],
      },
    ]);
    render(<App config={{ homeserverUrl: HS }} />);
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Ops/));
  });

  it("stays on Home when joined to multiple spaces and none resolves as the workforce space", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId: "!ops:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.create",
            sender: me,
            stateKey: "",
            content: { type: "m.space" },
          },
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "Ops" },
          },
        ],
      },
      {
        roomId: "!eng:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.create",
            sender: me,
            stateKey: "",
            content: { type: "m.space" },
          },
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "Eng" },
          },
        ],
      },
    ]);
    render(<App config={{ homeserverUrl: HS }} />);
    await waitFor(() =>
      expect(screen.getByTestId("logged-in-view")).toBeInTheDocument(),
    );
    expect(activeWorkspace()).toBe("Home");
  });

  it("toggles the sidebar with Cmd-B / Ctrl-B", async () => {
    const user = userEvent.setup();
    render(<App config={{ homeserverUrl: HS }} />);
    await waitFor(() =>
      expect(screen.getByTestId("logged-in-view")).toBeInTheDocument(),
    );
    const sidebar = document.querySelector(
      '[data-slot="sidebar"]',
    ) as HTMLElement;
    expect(sidebar).not.toBeNull();
    expect(sidebar.getAttribute("data-state")).toBe("expanded");

    await user.keyboard("{Meta>}b{/Meta}");
    await waitFor(() =>
      expect(sidebar.getAttribute("data-state")).toBe("collapsed"),
    );

    await user.keyboard("{Meta>}b{/Meta}");
    await waitFor(() =>
      expect(sidebar.getAttribute("data-state")).toBe("expanded"),
    );
  });

  it("keeps a collapsed sidebar collapsed across a reload", async () => {
    localStorage.setItem("fabrium:sidebar-open", "false");
    render(<App config={{ homeserverUrl: HS }} />);
    await waitFor(() =>
      expect(screen.getByTestId("logged-in-view")).toBeInTheDocument(),
    );
    expect(
      document
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-state"),
    ).toBe("collapsed");
  });

  it("opens the room pane from ?pane= and closes it with Escape", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId: "!r:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "general" },
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(
      <App
        config={{ homeserverUrl: HS }}
        initialRoute="/room/!r:h.example?pane=info"
      />,
    );
    expect(
      await screen.findByRole("complementary", { name: "Room info" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Room info" }),
      ).toBeNull(),
    );
  });

  it("opens a thread in the right pane from its summary row and closes it with Escape", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId: "!r:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "general" },
          },
        ],
        timeline: [
          {
            type: "m.room.message",
            sender: me,
            eventId: "$root",
            content: { msgtype: "m.text", body: "the root" },
          },
          {
            type: "m.room.message",
            sender: "@bob:h.example",
            eventId: "$reply",
            content: {
              msgtype: "m.text",
              body: "a reply",
              "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
            },
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(
      <App
        config={{ homeserverUrl: HS }}
        initialRoute="/room/!r:h.example?pane=info"
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: /view thread with 1 reply/i }),
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    // The thread takes the pane's place.
    expect(
      screen.queryByRole("complementary", { name: "Room info" }),
    ).toBeNull();
    expect(await within(pane).findByText("a reply")).toBeInTheDocument();
    expect(
      within(pane).getByRole("textbox", { name: /message/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Thread" }),
      ).toBeNull(),
    );
  });

  it("opens the thread from ?thread=", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId: "!r:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "general" },
          },
        ],
        timeline: [
          {
            type: "m.room.message",
            sender: me,
            eventId: "$root",
            content: { msgtype: "m.text", body: "the root" },
          },
        ],
      },
    ]);
    render(
      <App
        config={{ homeserverUrl: HS }}
        initialRoute="/room/!r:h.example?thread=$root"
      />,
    );
    const pane = await screen.findByRole("complementary", { name: "Thread" });
    expect(await within(pane).findByText("the root")).toBeInTheDocument();
  });

  it("moves between sidebar rooms with Alt+ArrowDown", async () => {
    stubSyncWithRooms(HS, [
      {
        roomId: "!a:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "alpha" },
          },
        ],
      },
      {
        roomId: "!b:h.example",
        myUserId: me,
        state: [
          {
            type: "m.room.name",
            sender: me,
            stateKey: "",
            content: { name: "beta" },
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(
      <App config={{ homeserverUrl: HS }} initialRoute="/room/!a:h.example" />,
    );
    const alpha = await screen.findByRole("link", { name: /alpha/ });
    await waitFor(() => expect(alpha).toHaveAttribute("data-active", "true"));
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /beta/ })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
  });
});

describe("<LoggedInView /> workforce space from runtime config", () => {
  const space = (roomId: string, name: string) => ({
    roomId,
    myUserId: me,
    state: [
      {
        type: "m.room.create",
        sender: me,
        stateKey: "",
        content: { type: "m.space" },
      },
      { type: "m.room.name", sender: me, stateKey: "", content: { name } },
    ],
  });
  const aliases: Record<string, string> = {
    "#dev:h.example": "!dev:h.example",
    "#ops:h.example": "!ops:h.example",
    "#eng:h.example": "!eng:h.example",
  };

  beforeEach(() => {
    relaxUnhandled();
    stubStartClient(HS);
    mswServer.use(
      http.get(
        `${HS}/_matrix/client/v3/directory/room/:alias`,
        ({ params }) => {
          const roomId = aliases[decodeURIComponent(String(params.alias))];
          return roomId
            ? HttpResponse.json({ room_id: roomId, servers: ["h.example"] })
            : HttpResponse.json(
                { errcode: "M_NOT_FOUND", error: "no alias" },
                { status: 404 },
              );
        },
      ),
      // The alias can resolve before sync has delivered the room, so the
      // client joins it; the joined room then arrives via sync.
      http.post(`${HS}/_matrix/client/v3/join/:alias`, ({ params }) =>
        HttpResponse.json({
          room_id: aliases[decodeURIComponent(String(params.alias))],
        }),
      ),
    );
    localStorage.setItem(
      "zoon:session",
      JSON.stringify({
        homeserverUrl: HS,
        accessToken: "tok",
        userId: me,
        deviceId: "DEV1",
      }),
    );
  });
  afterEach(() => {
    MatrixClientPeg.reset();
    localStorage.clear();
  });

  async function renderWith(
    workforceSpace: string | undefined,
    rooms = [
      space("!dev:h.example", "Dev"),
      space("!ops:h.example", "Ops"),
      space("!eng:h.example", "Eng"),
    ],
  ) {
    stubSyncWithRooms(HS, rooms);
    render(<App config={{ homeserverUrl: HS, workforceSpace }} />);
    await waitFor(() =>
      expect(screen.getByTestId("logged-in-view")).toBeInTheDocument(),
    );
  }

  it("defaults to #dev when workforce_space is omitted", async () => {
    await renderWith(undefined);
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Dev/));
  });

  it("selects the configured space", async () => {
    await renderWith("ops");
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Ops/));
  });

  it("serves different spaces from the same app with different runtime config", async () => {
    await renderWith("ops");
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Ops/));
    cleanup();
    MatrixClientPeg.reset();
    localStorage.setItem(
      "zoon:session",
      JSON.stringify({
        homeserverUrl: HS,
        accessToken: "tok",
        userId: me,
        deviceId: "DEV1",
      }),
    );
    await renderWith("eng");
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Eng/));
  });

  it("falls back to the sole joined space when the configured alias doesn't resolve", async () => {
    await renderWith("missing", [space("!ops:h.example", "Ops")]);
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Ops/));
  });

  it("falls back to the sole joined space when the value is invalid", async () => {
    await renderWith("#ops:h.example", [space("!eng:h.example", "Eng")]);
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Eng/));
  });

  it("falls back to Home when unresolved and several spaces are joined", async () => {
    await renderWith("missing");
    await waitFor(() => expect(activeWorkspace()).toBe("Home"));
  });

  it("remembers the chosen workspace across a reload", async () => {
    localStorage.setItem("fabrium:workspace", "!eng:h.example");
    await renderWith("ops");
    await waitFor(() => expect(activeWorkspace()).toMatch(/^Eng/));
  });

  it("falls back to Home when the value is invalid and several spaces are joined", async () => {
    await renderWith("a b");
    await waitFor(() => expect(activeWorkspace()).toBe("Home"));
  });
});
