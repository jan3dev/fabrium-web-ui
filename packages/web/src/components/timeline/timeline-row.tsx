// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/TimelineMessageRow.tsx. Modified.
import type { MatrixEvent } from "matrix-js-sdk";
import type * as React from "react";

import { TurnBlock } from "@/components/agents/activity/turn-block";
import type { DecodedZooidEvent } from "@/events/zooid-events";
import type { AgentTurn, ApprovalView } from "@/model/agent-activity";
import type { TimelineEntry } from "@/model/types";
import { ApprovalCard } from "./approval-card";
import { ErrorTile } from "./error-tile";
import { MessageRow, type MessageRowActions } from "./message-row";
import { QuestionCard } from "./question-card";
import { SystemRow } from "./system-row";
import { TimelineGap } from "./timeline-gap";

export interface TimelineRowProps {
  entry: TimelineEntry;
  roomId: string;
  actions: MessageRowActions;
  isContinuation?: boolean;
  isFollowedByContinuation?: boolean;
  highlighted?: boolean;
  truncateBody?: boolean;
  /** The gap currently being backfilled. */
  fillingGapId?: string | null;
  onFillGap?: (eventId: string) => void;
}

function AgentCard({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1">{children}</div>;
}

/** One timeline row, chosen by the entry's kind. */
export function TimelineRow({
  entry,
  roomId,
  actions,
  isContinuation,
  isFollowedByContinuation,
  highlighted,
  truncateBody,
  fillingGapId,
  onFillGap,
}: TimelineRowProps) {
  const { message } = entry;
  switch (message.kind) {
    case "message":
      return (
        <MessageRow
          message={message}
          thread={entry.thread}
          roomId={roomId}
          actions={actions}
          isContinuation={isContinuation}
          isFollowedByContinuation={isFollowedByContinuation}
          highlighted={highlighted}
          truncateBody={truncateBody}
        />
      );
    case "membership":
    case "state":
    case "divider":
      return <SystemRow message={message} />;
    case "gap": {
      const eventId = message.raw as string;
      return (
        <div className="px-3">
          <TimelineGap loading={fillingGapId === eventId} onClick={() => onFillGap?.(eventId)} />
        </div>
      );
    }
    case "approval":
      return (
        <AgentCard>
          <ApprovalCard roomId={roomId} approval={message.raw as ApprovalView} agent={message.author} />
        </AgentCard>
      );
    // ponytail: the question card still reads its Matrix event; its hooks need the event's relations.
    case "question":
      return (
        <AgentCard>
          <QuestionCard event={message.raw as MatrixEvent} agent={message.author} />
        </AgentCard>
      );
    case "error":
      return (
        <AgentCard>
          <ErrorTile decoded={message.raw as Extract<DecodedZooidEvent, { kind: "error" }>} />
        </AgentCard>
      );
    case "agent-turn":
      return (
        <AgentCard>
          <TurnBlock turn={message.raw as AgentTurn} />
        </AgentCard>
      );
  }
}
