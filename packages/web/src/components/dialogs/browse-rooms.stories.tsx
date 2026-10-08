import type { Meta } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { userEvent, within } from "storybook/test";
import { makeFakeClient, makeRoom } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { BrowseRoomsDialog } from "./browse-rooms";

const ME = "@me:h.example";
const SPACE_ID = "!space:h.example";

const HIERARCHY = [
  { room_id: SPACE_ID, name: "Acme", room_type: "m.space" },
  { room_id: "!general:h.example", name: "general", topic: "town square", num_joined_members: 4 },
  { room_id: "!design:h.example", name: "design", topic: "pixels and prototypes", num_joined_members: 2 },
  { room_id: "!ops:h.example", name: "ops", topic: "deploys and incidents", num_joined_members: 3 },
  { room_id: "!random:h.example", name: "random", num_joined_members: 1 },
  { room_id: "!payments:h.example", name: "Payments", room_type: "m.space", num_joined_members: 9 },
];

function seed(rooms: typeof HIERARCHY, joined: string[] = []) {
  const client = makeFakeClient({ userId: ME });
  const cast = client as unknown as Record<string, unknown>;
  cast.getRoom = (id: string) => {
    if (!joined.includes(id)) return null;
    const room = makeRoom(id, { client, myUserId: ME });
    (room as unknown as { getMyMembership: () => string }).getMyMembership = () => "join";
    return room;
  };
  cast.joinRoom = async (id: string) => {
    await new Promise((r) => setTimeout(r, 800));
    return { roomId: id };
  };
  cast.getRoomHierarchy = async () => ({ rooms });
  MatrixClientPeg.injectClientForTest(client);
}

const meta = {
  title: "Dialogs/BrowseRooms",
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta;

export default meta;

export const Populated = {
  render() {
    seed(HIERARCHY, ["!general:h.example"]);
    return <BrowseRoomsDialog open spaceId={SPACE_ID} onOpenChange={() => {}} />;
  },
};

export const NoRooms = {
  render() {
    seed(HIERARCHY.slice(0, 1));
    return <BrowseRoomsDialog open spaceId={SPACE_ID} onOpenChange={() => {}} />;
  },
};

export const NoMatch = {
  render() {
    seed(HIERARCHY);
    return <BrowseRoomsDialog open spaceId={SPACE_ID} onOpenChange={() => {}} />;
  },
  async play() {
    const body = within(document.body);
    await userEvent.type(await body.findByPlaceholderText(/search rooms/i), "no such room");
  },
};
