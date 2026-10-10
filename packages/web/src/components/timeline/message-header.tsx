// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageHeader.tsx, MessageAuthorWithIndicators.tsx. Modified.
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ActorSummary } from "@/model/types";

export function MessageHeaderRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0", className)}
      data-testid="message-header"
    >
      {children}
    </div>
  );
}

/**
 * Header facts separated by a middot, skipping empty slots. Each divider wraps
 * together with the segment it precedes, so a line never starts with one.
 */
export function MessageMetaSegments({
  segments,
}: {
  segments: ReadonlyArray<{ key: string; node: React.ReactNode }>;
}) {
  const present = segments.filter((slot) => Boolean(slot.node));
  return (
    <>
      {present.map(({ key, node }, index) =>
        index === 0 ? (
          <React.Fragment key={key}>{node}</React.Fragment>
        ) : (
          <span className="inline-flex min-w-0 items-baseline gap-x-1.5" key={key}>
            <span aria-hidden="true" className="text-caption1 text-text-tertiary">
              ·
            </span>
            {node}
          </span>
        ),
      )}
    </>
  );
}

const ACTOR_BADGE = { agent: "Agent", system: "System" } as const;

/** Author name, plus an Agent or System chip. Humans carry no chip. */
export function MessageAuthor({ author }: { author: ActorSummary }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span
        className="truncate text-body2 font-semibold text-text-primary"
        data-testid="message-author"
        title={author.id}
      >
        {author.displayName}
      </span>
      {author.kind === "human" ? null : (
        <Badge tone={author.kind} className="self-center px-1.5 py-0 text-caption2">
          {ACTOR_BADGE[author.kind]}
        </Badge>
      )}
    </span>
  );
}
