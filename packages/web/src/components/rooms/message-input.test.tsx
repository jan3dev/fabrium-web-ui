import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomMember } from "matrix-js-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixClientPeg } from "@/client/peg";
import { makeFakeClient, makeRoom } from "../../../test/factories";
import { detectAutocomplete, MessageInput, type MessageInputProps } from "./message-input";

const me = "@me:h.example";
const roomId = "!r:h.example";

function setup() {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me });
  const alice = new RoomMember(roomId, "@alice:h.example");
  alice.name = "alice";
  (room as unknown as { getJoinedMembers: () => RoomMember[] }).getJoinedMembers = () => [alice];
  (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
  MatrixClientPeg.injectClientForTest(client);
}

function renderInput(props: Partial<MessageInputProps> = {}) {
  setup();
  const onSubmit = vi.fn();
  render(<MessageInput roomId={roomId} onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup(), input: screen.getByRole("textbox", { name: /message/i }) };
}

afterEach(() => {
  cleanup();
  MatrixClientPeg.reset();
});

describe("<MessageInput />", () => {
  it("submits the text with mentions expanded, and clears", async () => {
    const { onSubmit, user, input } = renderInput();
    await user.type(input, "hi @alice ");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      body: "hi @alice:h.example",
      rawBody: "hi @alice",
      mentionUserIds: ["@alice:h.example"],
      attachments: [],
    });
    expect(input).toHaveTextContent("");
  });

  it("keeps the text and reports the error when onSubmit throws", async () => {
    const onError = vi.fn();
    const { user, input } = renderInput({ onSubmit: () => Promise.reject(new Error("nope")), onError });
    await user.type(input, "hi{Enter}");
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith("nope"));
    expect(input).toHaveTextContent("hi");
  });

  it("ignores an empty submit unless allowEmpty", async () => {
    const first = renderInput();
    await first.user.type(first.input, "{Enter}");
    expect(first.onSubmit).not.toHaveBeenCalled();
    cleanup();
    const second = renderInput({ allowEmpty: true });
    await second.user.type(second.input, "{Enter}");
    expect(second.onSubmit).toHaveBeenCalled();
  });

  it("offers slash commands and attachments by default, and drops them when off", async () => {
    const on = renderInput({ threadScoped: true });
    await on.user.type(on.input, "/");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Attach file").length).toBeGreaterThan(0);
    cleanup();
    const off = renderInput({ slashCommands: false, attachments: false });
    await off.user.type(off.input, "/");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByLabelText("Attach file")).toBeNull();
  });

  it("stacks the suggestion dropup above timeline hover bars", async () => {
    const { user, input } = renderInput({ threadScoped: true });
    await user.type(input, "/");
    expect(screen.getByRole("listbox").closest(".absolute")).toHaveClass("z-30");
  });

  it("does not submit while disabled", () => {
    renderInput({ disabled: true, placeholder: "Pick a room first" });
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });
});

describe("detectAutocomplete", () => {
  it("finds the trigger the caret is in", () => {
    expect(detectAutocomplete("hi @al", 6, true)).toEqual({ mode: "mention", start: 3, query: "al" });
    expect(detectAutocomplete("see #gen", 8, true)).toEqual({ mode: "room", start: 4, query: "gen" });
    expect(detectAutocomplete("ok :thu", 7, true)).toEqual({ mode: "emoji", start: 3, query: "thu" });
    expect(detectAutocomplete("/cl", 3, true)).toEqual({ mode: "slash", start: 0, query: "cl" });
  });

  it("stays closed outside a trigger", () => {
    expect(detectAutocomplete("a@b", 3, true)).toBeNull(); // not at a word start
    expect(detectAutocomplete("@al ", 4, true)).toBeNull(); // past the token
    expect(detectAutocomplete("@bob:h", 6, true)).toBeNull(); // a full user ID
    expect(detectAutocomplete("re: x", 3, true)).toBeNull(); // a colon, not a shortcode
    expect(detectAutocomplete("/cl", 3, false)).toBeNull();
    expect(detectAutocomplete("/clear now", 10, true)).toBeNull();
  });
});
