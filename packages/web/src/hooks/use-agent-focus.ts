import { useEffect, useMemo, useState } from "react";
import { listAgentFocus } from "@/client/fabrium-api";
import { isPreviewsEnabled } from "@/client/feature-flags";
import { readAgentFocus } from "@/lib/artifacts/pins";
import type { AgentFocusInfo } from "@/model/types";
import { useOpenTurns } from "./use-timeline-entries";

const POLL_MS = 1500;

export interface AgentCursor extends AgentFocusInfo {
  /** The agent, "Name · Project". */
  label: string;
}

/**
 * The agent cursor in this thread (spec §6.8, plan P6): where each agent with a running turn
 * here works, from the previews `focus` live state. Polled only during such a turn; a focus
 * from an earlier turn never shows, and the daemon clears it when the turn ends.
 */
export function useAgentFocus(roomId: string, threadRootId: string, workforceSpaceId: string | null): AgentCursor[] {
  // Previews off: no room, so no scan of the room's events on every event.
  const turns = useOpenTurns(isPreviewsEnabled() ? roomId : "", workforceSpaceId);
  const working = useMemo(
    () => turns.filter((t) => t.threadRootId === threadRootId),
    [turns, threadRootId],
  );
  // A new turn is a new key: what the last one polled is dropped, not shown until the next answer.
  const key = working.map((t) => t.id).join(",");
  const [state, setState] = useState<{ key: string; list: AgentFocusInfo[] }>({ key: "", list: [] });
  useEffect(() => {
    if (!key) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      // Previews off on this server, or not reachable: no cursor until a poll answers again.
      const list = await listAgentFocus(roomId).then(
        (raw) => readAgentFocus(raw).filter((f) => f.thread_root === threadRootId),
        () => [],
      );
      if (!live) return;
      setState((s) => (s.key === key && JSON.stringify(s.list) === JSON.stringify(list) ? s : { key, list }));
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [roomId, threadRootId, key]);
  return useMemo(() => {
    if (state.key !== key) return [];
    const labels = new Map(working.map((t) => [t.agent.id, t.agent.displayName]));
    return state.list.flatMap((f) => {
      const label = labels.get(f.agent_id);
      return label ? [{ ...f, label }] : [];
    });
  }, [state, key, working]);
}
