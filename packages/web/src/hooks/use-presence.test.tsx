import { act, renderHook } from "@testing-library/react";
import { EventEmitter } from "events";
import { ClientEvent, SyncState, UserEvent } from "matrix-js-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakeClient } from "../../test/factories";
import { MatrixClientPeg } from "../client/peg";
import { usePresence } from "./use-presence";

const me = "@me:h.example";
const agent = "@architect.acme:h.example";

function makeFakeUser(userId: string, presence = "offline") {
  return Object.assign(new EventEmitter(), {
    userId,
    presence,
    presenceStatusMsg: null as string | null,
  });
}

afterEach(() => MatrixClientPeg.reset());

describe("usePresence", () => {
  it("returns offline when user not found", () => {
    const client = makeFakeClient({ userId: me });
    (client as unknown as { getUser: () => null }).getUser = () => null;
    MatrixClientPeg.injectClientForTest(client);
    const { result } = renderHook(() => usePresence(agent));
    expect(result.current.presence).toBe("offline");
  });

  it("returns current presence from User object", () => {
    const client = makeFakeClient({ userId: me });
    const user = makeFakeUser(agent, "online");
    (client as unknown as { getUser: (id: string) => unknown }).getUser = () => user;
    MatrixClientPeg.injectClientForTest(client);
    const { result } = renderHook(() => usePresence(agent));
    expect(result.current.presence).toBe("online");
  });

  it("updates when UserEvent.Presence fires", async () => {
    const client = makeFakeClient({ userId: me });
    const user = makeFakeUser(agent, "online");
    (client as unknown as { getUser: (id: string) => unknown }).getUser = () => user;
    MatrixClientPeg.injectClientForTest(client);
    const { result } = renderHook(() => usePresence(agent));
    expect(result.current.presence).toBe("online");
    act(() => {
      user.presence = "unavailable";
      user.emit(UserEvent.Presence, null, user);
    });
    expect(result.current.presence).toBe("unavailable");
  });

  it("shows our own user online while the sync runs, before the server echoes it", () => {
    const client = makeFakeClient({ userId: me });
    let sync: SyncState | null = SyncState.Syncing;
    Object.assign(client, {
      getUser: () => makeFakeUser(me, "offline"),
      getSyncState: () => sync,
    });
    MatrixClientPeg.injectClientForTest(client);
    const { result } = renderHook(() => usePresence(me));
    expect(result.current.presence).toBe("online");
    act(() => {
      sync = SyncState.Error;
      client.emit(ClientEvent.Sync, sync, SyncState.Syncing);
    });
    expect(result.current.presence).toBe("offline");
  });
});
