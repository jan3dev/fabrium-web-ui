import { ApprovalEventType } from "../../events/approval";
import { useApproval } from "../../hooks/use-approval";
import { useMyPowerLevel } from "../../hooks/use-my-power-level";
import { useNow } from "../../hooks/use-now";
import { useUserName } from "../../hooks/use-user-name";
import { buildToolSummary } from "@/lib/agent-activity/tool-summary";
import type { ApprovalView } from "@/model/agent-activity";
import type { ActorSummary } from "@/model/types";
import { ApprovalCardView } from "./approval-card-view";

export function ApprovalCard({
  roomId,
  approval,
  agent,
}: {
  roomId: string;
  approval: ApprovalView;
  agent: ActorSummary;
}) {
  const { request, resolution, expired, viewerIsAgent } = approval;
  const power = useMyPowerLevel(roomId);
  const { state, error, send } = useApproval(roomId, request, resolution !== null);
  const respondedBy = useUserName(resolution?.respondedBy ?? "", roomId);
  const now = useNow();

  const input =
    request.toolInput && typeof request.toolInput === "object" && !Array.isArray(request.toolInput)
      ? (request.toolInput as Record<string, unknown>)
      : null;
  const summary = buildToolSummary({
    type: "tool",
    id: request.toolCallId,
    title: request.toolTitle ?? request.toolKind ?? "Tool call",
    toolKind: request.toolKind ?? "other",
    status: "pending",
    rawInput: input,
    content: null,
    diffs: [],
    locations: [],
    startedAt: 0,
    lastActivityAt: 0,
  });
  const blockedReason = viewerIsAgent
    ? "Only humans can answer an approval."
    : power.canSendEvent(ApprovalEventType.Response)
      ? undefined
      : "You have insufficient permission to respond to this approval.";

  return (
    <ApprovalCardView
      agentName={agent.displayName}
      title={request.toolTitle ?? request.toolKind ?? "Tool call"}
      subtitle={summary.objectTitle ?? undefined}
      detail={request.toolInput !== undefined ? safeStringify(request.toolInput) : undefined}
      resolution={resolution ? { ...resolution, respondedBy } : undefined}
      expired={expired}
      error={error ?? undefined}
      blockedReason={blockedReason}
      options={request.options}
      sending={state === "sending"}
      now={now}
      onRespond={send}
    />
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
