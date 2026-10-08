import type { Meta } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { makeFakeClient, makeRoom, mkMatrixEvent } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { roleForLevel } from "../../lib/roles";
import { MemberRow } from "./member-row";

export const ME = "@me:h.example";
export const ROOM = "!room:h.example";
const SPACE = "!workforce:h.example";
export const CODER = "@coder:h.example";
export const ALICE = "@alice:h.example";

const LEVELS: Record<string, number> = { [ME]: 100, [ALICE]: 50, "@bob:h.example": 0, [CODER]: 0 };

/** A room with a few people and one agent, listed in a workforce roster. */
export function seedPeopleClient() {
  const client = makeFakeClient({ userId: ME });
  const room = makeRoom(ROOM, { client, myUserId: ME, powerLevels: LEVELS });
  room.name = "payments";
  const names: Record<string, string> = { [ME]: "Me", [ALICE]: "Alice", "@bob:h.example": "Bob", [CODER]: "coder" };
  room.currentState.setStateEvents(
    Object.keys(LEVELS).map((uid) =>
      mkMatrixEvent({
        roomId: ROOM,
        sender: uid,
        type: "m.room.member",
        stateKey: uid,
        content: { membership: "join", displayname: names[uid] },
      }),
    ),
  );
  room.updateMyMembership("join");
  const space = makeRoom(SPACE, { client, myUserId: ME });
  space.name = "Acme";
  space.currentState.setStateEvents([
    mkMatrixEvent({ roomId: SPACE, sender: ME, type: "m.room.create", stateKey: "", content: { type: "m.space" } }),
    mkMatrixEvent({
      roomId: SPACE,
      sender: "@zooid:h.example",
      type: "dev.zooid.workforce",
      stateKey: "",
      content: {
        version: 1,
        agents: [{ user_id: CODER, name: "coder", persona: "Coder", project: "Payments", rooms: [ROOM] }],
      },
    }),
  ]);
  const rooms = new Map([
    [ROOM, room],
    [SPACE, space],
  ]);
  Object.assign(client as unknown as Record<string, unknown>, {
    getRoom: (id: string) => rooms.get(id) ?? null,
    getRooms: () => [...rooms.values()],
    kick: async () => undefined,
    ban: async () => undefined,
  });
  MatrixClientPeg.injectClientForTest(client);
}

const meta = { title: "People/MemberRow" } satisfies Meta;
export default meta;

const member = (userId: string) => ({ userId, displayName: userId, powerLevel: LEVELS[userId]!, role: roleForLevel(LEVELS[userId]!) });

export const Rows = {
  render() {
    seedPeopleClient();
    return (
      <MemoryRouter>
        <div className="flex w-72 flex-col">
          {[ME, ALICE, "@bob:h.example"].map((id) => (
            <div key={id} className="h-11">
              <MemberRow roomId={ROOM} userId={id} member={member(id)} />
            </div>
          ))}
          <div className="h-11">
            <MemberRow roomId={ROOM} userId={CODER} member={member(CODER)} agent working />
          </div>
          <div className="h-11">
            <MemberRow roomId={ROOM} userId={CODER} member={member(CODER)} agent />
          </div>
          <div className="h-11">
            <MemberRow roomId={ROOM} userId="@carol:h.example" membership="invite" />
          </div>
        </div>
      </MemoryRouter>
    );
  },
};
