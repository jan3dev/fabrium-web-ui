import type { Meta } from "@storybook/react-vite";
import { UserResultRow } from "./user-result-row";

const meta = { title: "Dialogs/UserResultRow" } satisfies Meta;
export default meta;

export const Rows = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <UserResultRow userId="@alice:h.example" name="Alice Example" />
      <UserResultRow userId="@bob:h.example" name="Bob" selected />
      <UserResultRow userId="@coder:h.example" name="Coder · Payments" agent />
      <UserResultRow
        userId="@someone-with-a-very-long-localpart:a-long-homeserver.example"
        name="Someone with a display name too long for the row"
      />
    </div>
  ),
};
