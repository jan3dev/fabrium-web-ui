import { useEffect, useState } from "react";
import { ClientEvent, SyncState } from "matrix-js-sdk";
import { MatrixClientPeg } from "../client/peg";
import { subscribeUserPresence } from "./matrix-subscriptions";

export interface PresenceState {
  presence: "online" | "offline" | "unavailable";
  statusMsg: string | null;
}

const OFFLINE: PresenceState = { presence: "offline", statusMsg: null };
const LIVE = new Set<SyncState | null>([
  SyncState.Prepared,
  SyncState.Syncing,
  SyncState.Catchup,
]);

function readPresence(userId: string): PresenceState {
  const client = MatrixClientPeg.safeGet();
  const user = client?.getUser(userId);
  const statusMsg = user?.presenceStatusMsg ?? null;
  // Our own presence: the sync loop sends set_presence=online, but the server's
  // m.presence echo lags (and starts from the last session's "offline"). A live
  // sync is the better signal.
  if (client && userId === client.getUserId()) {
    return {
      presence: LIVE.has(client.getSyncState?.() ?? null)
        ? "online"
        : "offline",
      statusMsg,
    };
  }
  if (!user) return OFFLINE;
  return {
    presence: (user.presence as PresenceState["presence"]) ?? "offline",
    statusMsg,
  };
}

export function usePresence(userId: string): PresenceState {
  const [state, setState] = useState<PresenceState>(() => readPresence(userId));

  useEffect(() => {
    const update = () => setState(readPresence(userId));
    update();
    // Shared, refcounted presence fan-out: one client-level listener serves all
    // rows instead of one per component (which leaks on big member lists).
    const unsub = subscribeUserPresence(userId, update);
    const client = MatrixClientPeg.safeGet();
    if (!client || userId !== client.getUserId()) return unsub;
    client.on(ClientEvent.Sync, update);
    return () => {
      unsub();
      client.off(ClientEvent.Sync, update);
    };
  }, [userId]);

  return state;
}
