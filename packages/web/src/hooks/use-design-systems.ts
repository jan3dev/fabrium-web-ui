import { ClientEvent, RoomStateEvent, type MatrixEvent } from "matrix-js-sdk";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { MatrixClientPeg } from "@/client/peg";
import {
  decodeDesignSystemPrefs,
  decodeDesignSystems,
  DesignSystemPrefsType,
  DesignSystemsEventType,
  encodeDesignSystemPrefs,
  encodeDesignSystems,
  mergeDesignSystems,
} from "@/events/fabrium-design-systems";
import type { DesignSystemEntry, DesignSystemPrefs } from "@/model/types";
import { projectSpaceId } from "./use-member-roles";
import { subscribeRoomState } from "./matrix-subscriptions";
import { useMyPowerLevel } from "./use-my-power-level";

export interface DesignSystems {
  /** The workspace's list, as its settings edit it. */
  workspace: DesignSystemEntry[];
  /** What new work in `roomId` can use: its project's systems, then the workspace's. */
  systems: DesignSystemEntry[];
  prefs: DesignSystemPrefs;
  /** Owners and admins: may write the workspace's list. */
  canManage: boolean;
  saveWorkspace(systems: readonly DesignSystemEntry[]): Promise<void>;
  savePrefs(prefs: DesignSystemPrefs): Promise<void>;
}

const NONE: readonly (MatrixEvent | null)[] = [null, null, null];

function stateEvent(roomId: string | null): MatrixEvent | null {
  if (!roomId) return null;
  return MatrixClientPeg.safeGet()?.getRoom(roomId)?.currentState.getStateEvents(DesignSystemsEventType, "") ?? null;
}

/**
 * Design systems across threads (spec §5.6) for the workspace `spaceId` and, when
 * `roomId` is given, that room's project space.
 */
export function useDesignSystems(spaceId: string | null, roomId?: string | null): DesignSystems {
  const room = roomId ? (MatrixClientPeg.safeGet()?.getRoom(roomId) ?? null) : null;
  const projectId = projectSpaceId(room);
  const project = projectId === spaceId ? null : projectId;
  const subscribe = useCallback(
    (cb: () => void) => {
      const client = MatrixClientPeg.safeGet();
      const unsubs = [spaceId, project].flatMap((id) => (id ? [subscribeRoomState(id, [RoomStateEvent.Events], cb)] : []));
      const onAccountData = (ev: MatrixEvent) => {
        if (ev.getType() === DesignSystemPrefsType) cb();
      };
      client?.on(ClientEvent.AccountData, onAccountData);
      const unsubPeg = MatrixClientPeg.subscribe(cb);
      return () => {
        for (const u of unsubs) u();
        client?.off(ClientEvent.AccountData, onAccountData);
        unsubPeg();
      };
    },
    [spaceId, project],
  );
  // The three source events: the same array until one of them is replaced, so an
  // unrelated state change keeps the same snapshot.
  const cache = useRef(NONE);
  const events = useSyncExternalStore(
    subscribe,
    () => {
      const next = [
        stateEvent(spaceId),
        stateEvent(project),
        MatrixClientPeg.safeGet()?.getAccountData(DesignSystemPrefsType as never) ?? null,
      ];
      if (next.some((e, i) => e !== cache.current[i])) cache.current = next;
      return cache.current;
    },
    () => NONE,
  );
  const canManage = useMyPowerLevel(spaceId ?? "").canSendStateEvent(DesignSystemsEventType) && spaceId !== null;

  const view = useMemo(() => {
    const [ws, proj, prefs] = events.map((e) => e?.getContent());
    const workspace = decodeDesignSystems(ws);
    return {
      workspace,
      systems: mergeDesignSystems(decodeDesignSystems(proj), workspace),
      prefs: decodeDesignSystemPrefs(prefs),
    };
  }, [events]);

  const saveWorkspace = useCallback(
    async (systems: readonly DesignSystemEntry[]) => {
      const client = MatrixClientPeg.safeGet();
      if (!client || !spaceId) return;
      await client.sendStateEvent(spaceId, DesignSystemsEventType as never, encodeDesignSystems(systems) as never, "");
    },
    [spaceId],
  );
  const savePrefs = useCallback(async (prefs: DesignSystemPrefs) => {
    await MatrixClientPeg.safeGet()?.setAccountData(DesignSystemPrefsType as never, encodeDesignSystemPrefs(prefs) as never);
  }, []);

  return { ...view, canManage, saveWorkspace, savePrefs };
}
