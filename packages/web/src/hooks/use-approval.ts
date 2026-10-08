import { useCallback, useRef, useState } from "react";
import { MatrixClientPeg } from "../client/peg";
import { ApprovalEventType, type ApprovalDecision, type ApprovalRequest } from "../events/approval";

export type ApprovalState = "pending" | "sending" | "resolved" | "error";

export interface UseApproval {
  state: ApprovalState;
  error: string | null;
  send: (decision: ApprovalDecision, optionId?: string) => Promise<void>;
}

/**
 * Sends the response to one approval request. `resolved` comes from the view
 * model: once anyone has answered, send() does nothing.
 */
export function useApproval(roomId: string, request: ApprovalRequest, resolved: boolean): UseApproval {
  const [sendingState, setSendingState] = useState<{ sending: boolean; error: string | null }>({
    sending: false,
    error: null,
  });
  const inFlight = useRef(false);

  const send = useCallback(
    async (decision: ApprovalDecision, optionId?: string) => {
      if (resolved || inFlight.current) return;
      inFlight.current = true;
      setSendingState({ sending: true, error: null });
      try {
        const content: Record<string, unknown> = {
          approval_id: request.approvalId,
          session_id: request.sessionId,
          decision,
        };
        if (optionId) content.option_id = optionId;
        // sendEvent's TimelineEvents type doesn't know about dev.zooid.* types;
        // the SDK accepts arbitrary event types at runtime.
        await (MatrixClientPeg.get().sendEvent as (
          roomId: string,
          type: string,
          content: Record<string, unknown>,
        ) => Promise<{ event_id: string }>)(roomId, ApprovalEventType.Response, content);
        // Back to "pending" until the response echoes in, keeping inFlight so a
        // fast double-click can't send twice. Only an error releases the lock.
        setSendingState({ sending: false, error: null });
      } catch (e) {
        setSendingState({ sending: false, error: e instanceof Error ? e.message : String(e) });
        inFlight.current = false;
      }
    },
    [request.approvalId, request.sessionId, resolved, roomId],
  );

  let state: ApprovalState = "pending";
  if (resolved) state = "resolved";
  else if (sendingState.error) state = "error";
  else if (sendingState.sending) state = "sending";

  return { state, error: sendingState.error, send };
}
