import type { Meta, StoryContext } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ALICE, CODER, ROOM, seedPeopleClient } from "./structures/member-row.stories";
import { UserProfilePopover } from "./user-profile-popover";

const meta = { title: "People/UserProfilePopover" } satisfies Meta;
export default meta;

const open = async ({ canvas, userEvent }: StoryContext) => {
  await userEvent.click(canvas.getByRole("button"));
};

function Story({ userId }: { userId: string }) {
  seedPeopleClient();
  return (
    <MemoryRouter>
      <UserProfilePopover userId={userId} roomId={ROOM}>
        <Button variant="secondary">Open profile</Button>
      </UserProfilePopover>
    </MemoryRouter>
  );
}

export const Human = { render: () => <Story userId={ALICE} />, play: open };

export const Agent = { render: () => <Story userId={CODER} />, play: open };
