import type { Meta } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { userEvent, within } from "storybook/test";
import { makeFakeClient } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { CreateRoomDialog } from "./create-room";

function seed(opts: { fail?: boolean } = {}) {
  const client = makeFakeClient({ userId: "@me:h.example" });
  Object.assign(client as unknown as Record<string, unknown>, {
    createRoom: async () => {
      if (opts.fail) throw new Error("You are not allowed to create rooms in this workspace.");
      return { room_id: "!new:h.example" };
    },
    sendStateEvent: async () => ({ event_id: "$ev" }),
  });
  MatrixClientPeg.injectClientForTest(client);
}

const meta = {
  title: "Dialogs/CreateRoom",
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta;

export default meta;

export const Empty = {
  render() {
    seed();
    return <CreateRoomDialog open spaceId="!space:h.example" onOpenChange={() => {}} />;
  },
};

export const InviteOnly = {
  render() {
    seed();
    return <CreateRoomDialog open spaceId="!space:h.example" onOpenChange={() => {}} />;
  },
  async play() {
    const body = within(document.body);
    await userEvent.type(await body.findByLabelText(/name/i), "release-notes");
    await userEvent.type(body.getByLabelText(/topic/i), "What shipped, and when");
    await userEvent.click(body.getByRole("button", { name: /invite only/i }));
  },
};

export const ServerError = {
  render() {
    seed({ fail: true });
    return <CreateRoomDialog open spaceId="!space:h.example" onOpenChange={() => {}} />;
  },
  async play() {
    const body = within(document.body);
    await userEvent.type(await body.findByLabelText(/name/i), "release-notes");
    await userEvent.click(body.getByRole("button", { name: /create room/i }));
  },
};
