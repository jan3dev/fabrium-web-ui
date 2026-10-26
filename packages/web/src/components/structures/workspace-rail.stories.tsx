import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Room } from "matrix-js-sdk";
import { makeFakeClient, makeRoom } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { WorkspaceRail } from "./workspace-rail";

const ME = "@me:h.example";
const ACME = "!acme:h.example";

/** Two top-level workspaces, so the rail has buttons below Home and VM. */
function seed() {
  const client = makeFakeClient({ userId: ME });
  const rooms = new Map<string, Room>();
  for (const [id, name] of [
    [ACME, "Acme Corp"],
    ["!beta:h.example", "Beta"],
  ]) {
    const room = makeRoom(id, { client, myUserId: ME });
    Object.assign(room as unknown as Record<string, unknown>, {
      name,
      isSpaceRoom: () => true,
      getMyMembership: () => "join",
    });
    rooms.set(id, room);
  }
  const cast = client as unknown as Record<string, unknown>;
  cast.getRoom = (id: string) => rooms.get(id) ?? null;
  cast.getRooms = () => Array.from(rooms.values());
  MatrixClientPeg.injectClientForTest(client);
}

const meta = {
  title: "Structures/WorkspaceRail",
  component: WorkspaceRail,
  parameters: { layout: "centered" },
  args: { scope: { kind: "home" }, onSelect: () => {} },
  decorators: [
    (Story) => {
      seed();
      return (
        <div className="flex h-72 bg-sidebar">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof WorkspaceRail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A member sees no VM button. Home is current. */
export const Workspaces: Story = {};

/** An admin or owner sees VM below Home. Home is still current. */
export const WithVmButton: Story = {
  args: { vm: { active: false, onSelect: () => {} } },
};

/** The VM page is open. Only VM is current, over the Home scope. */
export const VmPageOpen: Story = {
  args: { vm: { active: true, onSelect: () => {} } },
};

/** The VM page is open over a workspace scope. Only VM is current. */
export const VmPageOpenOverWorkspace: Story = {
  args: {
    scope: { kind: "space", spaceId: ACME },
    vm: { active: true, onSelect: () => {} },
  },
};

/** A workspace is current while the VM page is closed. */
export const WorkspaceCurrent: Story = {
  args: {
    scope: { kind: "space", spaceId: ACME },
    vm: { active: false, onSelect: () => {} },
  },
};
