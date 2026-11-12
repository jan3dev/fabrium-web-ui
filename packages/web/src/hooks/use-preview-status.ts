import { useEffect, useState } from "react";
import { FabriumApiError, getPreview } from "@/client/fabrium-api";
import type { PreviewInfo } from "@/model/types";

const POLL_MS = 1500;
/** The log keeps its newest 64 KB. */
export const MAX_LOG_CHARS = 64 * 1024;

export function appendLog(log: string, text: string): string {
  const next = log + text;
  return next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next;
}

export interface PreviewStatusState {
  info: PreviewInfo | null;
  log: string;
  /** The last failed poll; 404 = previews off or unknown preview, 403 = no access. */
  error: FabriumApiError | null;
}

const EMPTY: PreviewStatusState = { info: null, log: "", error: null };

/** Polls a preview while mounted and keeps the tail of its log. Callers key it by preview. */
export function usePreviewStatus(agentId: string, name: string): PreviewStatusState {
  const [state, setState] = useState<PreviewStatusState>(EMPTY);
  useEffect(() => {
    let live = true;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const { log, ...info } = await getPreview(agentId, name, offset);
        if (!live) return;
        // The gateway replaced its log (a reconnect), or restarted: the offset goes back.
        const reset = !!log.reset || log.offset < offset;
        offset = log.offset;
        setState((s) =>
          // Most polls change nothing: keep the state, so the panel does not re-render.
          !reset && !log.text && !s.error && JSON.stringify(s.info) === JSON.stringify(info)
            ? s
            : { info, log: appendLog(reset ? "" : s.log, log.text), error: null },
        );
      } catch (err) {
        if (!live) return;
        const error =
          err instanceof FabriumApiError ? err : new FabriumApiError(0, String(err));
        setState((s) => ({ ...s, error }));
      }
      if (live) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [agentId, name]);
  return state;
}
