import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomMember } from "matrix-js-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeClient, makeRoom } from "../../../test/factories";
import { MatrixClientPeg } from "../../client/peg";
import { Composer } from "./composer";

const me = "@me:h.example";
const roomId = "!r:h.example";

function setup(send: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ event_id: "$m1" })) {
  const client = makeFakeClient({ userId: me });
  const room = makeRoom(roomId, { client, myUserId: me });
  (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
  (client as unknown as { sendEvent: unknown }).sendEvent = send;
  MatrixClientPeg.injectClientForTest(client);
  return { client, send };
}

afterEach(() => {
  cleanup();
  MatrixClientPeg.reset();
});

describe("<Composer />", () => {
  it("sends m.room.message at room scope when no thread is set", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "hello world{Enter}");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        roomId,
        null,                              // room mode → no thread
        "m.room.message",
        { msgtype: "m.text", body: "hello world" },
      ),
    );
    expect(input).toHaveTextContent("");
  });

  it("Shift+Enter inserts a newline instead of sending", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "line1{Shift>}{Enter}{/Shift}line2");
    expect(send).not.toHaveBeenCalled();
    expect(input).toHaveTextContent("line1line2");
    expect(input.querySelector("br:not(.ProseMirror-trailingBreak)")).not.toBeNull();
  });

  it("ignores Enter when the input is empty", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /message/i }), "{Enter}");
    expect(send).not.toHaveBeenCalled();
  });

  it("disables input + restores on send error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    setup(send);
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "hi{Enter}");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network/i));
    expect(input).toHaveAttribute("contenteditable", "true");
    expect(input).toHaveTextContent("hi");
  });

  // --- Mention autocomplete: activeIdx persistence ---
  describe("mention autocomplete activeIdx", () => {
    it("ArrowDown does not snap activeIdx back to 0", async () => {
      const client = makeFakeClient({ userId: me });
      const room = makeRoom(roomId, { client, myUserId: me });
      const aliceMember = new RoomMember(roomId, "@alice:h.example");
      aliceMember.name = "alice";
      const bobMember = new RoomMember(roomId, "@bob:h.example");
      bobMember.name = "bob";
      const roomMembers = [aliceMember, bobMember];
      (room as unknown as { getJoinedMembers: () => RoomMember[] }).getJoinedMembers = () => roomMembers;
      (client as unknown as { getRoom: () => unknown }).getRoom = () => room;
      (client as unknown as { sendEvent: unknown }).sendEvent = vi.fn().mockResolvedValue({ event_id: "$m1" });
      MatrixClientPeg.injectClientForTest(client);
      render(<Composer roomId={roomId} />);
      const user = userEvent.setup();
      const input = screen.getByRole("textbox", { name: /message/i });

      // Open mention autocomplete
      await user.type(input, "@");
      // Press ArrowDown once — should move to index 1
      await user.keyboard("{ArrowDown}");
      // Press ArrowDown again — should move to index 2 (wraps if only 2 entries → 0)
      await user.keyboard("{ArrowDown}");

      // The active item in the listbox should NOT be the first one
      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(0);

      // Move to index 1 and confirm Tab inserts the second member, not the first
      await user.keyboard("{ArrowDown}"); // index 0 → 1
      await user.keyboard("{Tab}");
      // Insertion uses the display name; the send maps it back to the user ID.
      expect(input).toHaveTextContent(/@bob\b/);
    });
  });

  // --- Slash command autocomplete ---
  it("a picked mention sends the user ID, a matrix.to pill and m.mentions", async () => {
    const { send } = setup();
    const room = MatrixClientPeg.safeGet()!.getRoom(roomId)!;
    const alice = new RoomMember(roomId, "@alice:h.example");
    alice.name = "Alice Liddell";
    (room as unknown as { getJoinedMembers: () => RoomMember[] }).getJoinedMembers = () => [alice];
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "@lid");
    await user.keyboard("{Enter}");
    expect(input).toHaveTextContent("@Alice Liddell");
    await user.type(input, "hi{Enter}");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(roomId, null, "m.room.message", {
        msgtype: "m.text",
        body: "@alice:h.example hi",
        format: "org.matrix.custom.html",
        // Exact HTML is covered in compose.test.ts; happy-dom's DOMPurify drops the <p>.
        formatted_body: expect.stringContaining('<a href="https://matrix.to/#/@alice:h.example">Alice Liddell</a> hi'),
        "m.mentions": { user_ids: ["@alice:h.example"] },
      }),
    );
  });

  describe("slash command autocomplete", () => {
    it("does not show /clear in room mode when / is typed", async () => {
      setup();
      render(<Composer roomId={roomId} />);
      const user = userEvent.setup();
      const input = screen.getByRole("textbox", { name: /message/i });
      await user.type(input, "/");
      // In room mode there are no slash commands — no listbox appears
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });
});

describe("<Composer /> thread mode", () => {
  it("sends with the thread root when threadRootEventId prop is set", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} threadRootEventId="$root" />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "in-thread{Enter}");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        roomId,
        "$root",                                // thread mode → root id
        "m.room.message",
        { msgtype: "m.text", body: "in-thread" },
      ),
    );
  });

  it("shows /clear in thread-mode slash autocomplete", async () => {
    setup();
    render(<Composer roomId={roomId} threadRootEventId="$root" />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "/");
    const list = screen.getByRole("listbox");
    expect(list).toBeDefined();
    expect(screen.getByText(/clear/i)).toBeDefined();
  });
});

describe("<Composer /> /clear scope", () => {
  it("/clear in thread mode sends dev.zooid.session_reset with the thread relation", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} threadRootEventId="$root" />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "/clear{Enter}");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        roomId,
        "$root",
        "dev.zooid.session_reset",
        { "m.relates_to": { rel_type: "m.thread", event_id: "$root" } },
      ),
    );
  });

  it("/clear is not in slash autocomplete in room mode", async () => {
    setup();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "/");
    // No /clear suggestion in room mode.
    expect(screen.queryByText(/^clear$/i)).toBeNull();
  });

  it("/clear typed at room scope falls through as plain text", async () => {
    const { send } = setup();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: /message/i });
    await user.type(input, "/clear{Enter}");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        roomId,
        null,
        "m.room.message",
        { msgtype: "m.text", body: "/clear" },
      ),
    );
  });
});

describe("<Composer /> attachments", () => {
  function setupWithUpload(opts: { uploadResult?: string } = {}) {
    const send = vi.fn().mockResolvedValue({ event_id: "$m1" });
    const uploadContent = vi
      .fn()
      .mockResolvedValue({ content_uri: opts.uploadResult ?? "mxc://hs/up1" });
    const { client } = setup(send);
    (client as unknown as { uploadContent: unknown }).uploadContent = uploadContent;
    return { send, uploadContent };
  }

  function pngFile(bytes: number, name = "shot.png"): File {
    return new File([new Uint8Array(bytes)], name, { type: "image/png" });
  }

  it("rejects files over 0.5 MB with an in-composer error and never uploads", async () => {
    const { uploadContent, send } = setupWithUpload();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const input = screen.getByLabelText(/attach file/i, { selector: "input" }) as HTMLInputElement;
    await user.upload(input, pngFile(524_289));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/0\.5\s?MB/i),
    );
    expect(uploadContent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("stages a valid file, then on send uploads and sends m.image before the text event", async () => {
    const { uploadContent, send } = setupWithUpload();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/attach file/i, { selector: "input" }), pngFile(1024, "dog.png"));
    expect(screen.getByTitle(/^dog\.png/)).toBeDefined(); // staged chip

    await user.type(screen.getByRole("textbox", { name: /message/i }), "look{Enter}");

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(uploadContent).toHaveBeenCalledOnce();
    const [, , firstType, firstContent] = send.mock.calls[0] as [
      string,
      string | null,
      string,
      Record<string, unknown>,
    ];
    expect(firstType).toBe("m.room.message");
    expect(firstContent).toMatchObject({
      msgtype: "m.image",
      body: "dog.png",
      url: "mxc://hs/up1",
      info: { mimetype: "image/png", size: 1024 },
    });
    const [, , , secondContent] = send.mock.calls[1] as [
      string,
      string | null,
      string,
      Record<string, unknown>,
    ];
    expect(secondContent).toMatchObject({ msgtype: "m.text", body: "look" });
  });

  it("sends a staged attachment even with no text typed", async () => {
    const { send } = setupWithUpload();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/attach file/i, { selector: "input" }), pngFile(1024, "dog.png"));
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0] as [unknown, unknown, unknown, Record<string, unknown>])[3]).toMatchObject({
      msgtype: "m.image",
    });
  });

  it("sends non-image files as m.file", async () => {
    const { send } = setupWithUpload();
    render(<Composer roomId={roomId} />);
    const user = userEvent.setup();
    const pdf = new File([new Uint8Array(2048)], "report.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText(/attach file/i, { selector: "input" }), pdf);
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(
        (send.mock.calls[0] as [unknown, unknown, unknown, Record<string, unknown>])[3],
      ).toMatchObject({
        msgtype: "m.file",
        body: "report.pdf",
        filename: "report.pdf",
        info: { mimetype: "application/pdf", size: 2048 },
      }),
    );
  });
});

describe("<Composer /> paste, drag-and-drop and the attachment tray", () => {
  function setupWithUpload() {
    const send = vi.fn().mockResolvedValue({ event_id: "$m1" });
    const uploadContent = vi
      .fn()
      .mockImplementation((f: File) =>
        Promise.resolve({ content_uri: `mxc://hs/${f.name}` }),
      );
    const { client } = setup(send);
    (client as unknown as { uploadContent: unknown }).uploadContent = uploadContent;
    return { send, uploadContent };
  }

  function png(bytes: number, name = "shot.png"): File {
    return new File([new Uint8Array(bytes)], name, { type: "image/png" });
  }

  /** happy-dom has no object-URL support; the chip only needs a string back. */
  function stubObjectUrls() {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  }

  /** The composer root is the element carrying the drag/drop handlers. */
  function renderComposer(): HTMLElement {
    const { container } = render(<Composer roomId={roomId} />);
    return container.firstElementChild as HTMLElement;
  }

  function fileDrag(files: File[]) {
    return {
      dataTransfer: {
        files,
        items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
        types: ["Files"],
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stages an image pasted from the clipboard and renames the generic clipboard name", async () => {
    stubObjectUrls();
    setupWithUpload();
    render(<Composer roomId={roomId} />);
    const input = screen.getByRole("textbox", { name: /message/i });

    fireEvent.paste(input, { clipboardData: { files: [png(1024, "image.png")], types: ["Files"] } });

    const tray = await screen.findByRole("list", { name: /staged attachments/i });
    expect(within(tray).getByTitle(/^pasted-\d{8}-\d{6}\.png /)).toBeDefined();
  });

  it("leaves a plain text paste to the browser", async () => {
    setupWithUpload();
    render(<Composer roomId={roomId} />);
    const input = screen.getByRole("textbox", { name: /message/i });

    const evt = fireEvent.paste(input, { clipboardData: { files: [], types: ["text/plain"] } });

    expect(evt).toBe(true); // not preventDefault()-ed
    expect(screen.queryByRole("list", { name: /staged attachments/i })).toBeNull();
  });

  it("keeps the real filename of a file pasted from the file manager", async () => {
    stubObjectUrls();
    setupWithUpload();
    render(<Composer roomId={roomId} />);

    fireEvent.paste(screen.getByRole("textbox", { name: /message/i }), {
      clipboardData: { files: [png(1024, "diagram.png")], types: ["Files"] },
    });

    expect(await screen.findByTitle(/^diagram\.png/)).toBeDefined();
  });

  it("stages files dropped onto the composer and shows a drop target while dragging", async () => {
    stubObjectUrls();
    setupWithUpload();
    const composer = renderComposer();

    fireEvent.dragEnter(composer, fileDrag([png(1024, "a.png")]));
    expect(screen.getByText(/drop to attach/i)).toBeDefined();

    fireEvent.drop(composer, fileDrag([png(1024, "a.png"), png(2048, "b.png")]));

    expect(screen.queryByText(/drop to attach/i)).toBeNull();
    const tray = await screen.findByRole("list", { name: /staged attachments/i });
    expect(within(tray).getByTitle(/^a\.png/)).toBeDefined();
    expect(within(tray).getByTitle(/^b\.png/)).toBeDefined();
  });

  it("ignores a drag that carries no files", () => {
    setupWithUpload();
    const composer = renderComposer();

    fireEvent.dragEnter(composer, { dataTransfer: { files: [], items: [], types: ["text/plain"] } });

    expect(screen.queryByText(/drop to attach/i)).toBeNull();
  });

  it("uploads and sends each staged attachment in tray order, then the text", async () => {
    stubObjectUrls();
    const { send, uploadContent } = setupWithUpload();
    const composer = renderComposer();
    const user = userEvent.setup();

    fireEvent.drop(composer, fileDrag([png(1024, "a.png"), png(2048, "b.png")]));
    await screen.findByRole("list", { name: /staged attachments/i });

    await user.type(screen.getByRole("textbox", { name: /message/i }), "two shots{Enter}");

    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(uploadContent).toHaveBeenCalledTimes(2);
    const bodies = send.mock.calls.map(
      (c) => (c as [unknown, unknown, unknown, Record<string, unknown>])[3],
    );
    expect(bodies[0]).toMatchObject({ msgtype: "m.image", body: "a.png", url: "mxc://hs/a.png" });
    expect(bodies[1]).toMatchObject({ msgtype: "m.image", body: "b.png", url: "mxc://hs/b.png" });
    expect(bodies[2]).toMatchObject({ msgtype: "m.text", body: "two shots" });
    expect(screen.queryByRole("list", { name: /staged attachments/i })).toBeNull();
  });

  it("removes a single attachment from the tray and leaves the rest staged", async () => {
    stubObjectUrls();
    setupWithUpload();
    const composer = renderComposer();
    const user = userEvent.setup();

    fireEvent.drop(composer, fileDrag([png(1024, "a.png"), png(2048, "b.png")]));
    const tray = await screen.findByRole("list", { name: /staged attachments/i });

    await user.click(within(tray).getByRole("button", { name: /remove a\.png/i }));

    expect(screen.queryByText("a.png")).toBeNull();
    expect(screen.getByTitle(/^b\.png/)).toBeDefined();
  });

  it("accepts the files that fit and reports the ones that do not", async () => {
    stubObjectUrls();
    setupWithUpload();
    const composer = renderComposer();

    fireEvent.drop(composer, fileDrag([png(1024, "ok.png"), png(524_289, "huge.png")]));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/0\.5\s?MB/i));
    const tray = screen.getByRole("list", { name: /staged attachments/i });
    expect(within(tray).getByTitle(/^ok\.png/)).toBeDefined();
    expect(within(tray).queryByText("huge.png")).toBeNull();
  });

  it("caps the tray at 8 attachments", async () => {
    stubObjectUrls();
    setupWithUpload();
    const composer = renderComposer();

    fireEvent.drop(
      composer,
      fileDrag(Array.from({ length: 10 }, (_, i) => png(512, `f${i}.png`))),
    );

    const tray = await screen.findByRole("list", { name: /staged attachments/i });
    expect(within(tray).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByRole("alert")).toHaveTextContent(/no more than 8 attachments/i);
  });
});
