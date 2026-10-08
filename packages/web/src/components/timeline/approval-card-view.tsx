// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/workflows/ui/WorkflowApprovalCard.tsx. Modified.
import { useState } from "react";
import {
  CircleCheckIcon,
  OctagonXIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface ApprovalOptionView {
  optionId?: string;
  name: string;
  /** ACP option kind, e.g. "allow_once" / "reject_once". */
  kind: string;
}

export interface ApprovalResolutionView {
  decision: "allow" | "cancel";
  /** Display name of whoever answered. */
  respondedBy: string;
  respondedAt?: number;
}

export interface ApprovalCardViewProps {
  /** The agent asking, e.g. "Coder · Payments". */
  agentName?: string;
  title: string;
  subtitle?: string;
  /** Pre-stringified tool input. When provided, a "Show details" toggle appears. */
  detail?: string;
  /** When present, the card renders in its resolved (decided) state. */
  resolution?: ApprovalResolutionView;
  /** The agent stopped waiting without an answer: shown as denied. */
  expired?: boolean;
  error?: string;
  /** Why the viewer cannot answer; the buttons are hidden when set. */
  blockedReason?: string;
  options: ApprovalOptionView[];
  sending?: boolean;
  /** Clock for the "answered 5m ago" line; defaults to now. */
  now?: number;
  onRespond?: (decision: "allow" | "cancel", optionId?: string) => void;
}

/**
 * Pure presentation of an approval request. {@link ApprovalCard} feeds it from
 * the view model; Storybook renders it with synthetic data.
 */
export function ApprovalCardView({
  agentName,
  title,
  subtitle,
  detail,
  resolution,
  expired,
  error,
  blockedReason,
  options,
  sending,
  now = Date.now(),
  onRespond,
}: ApprovalCardViewProps) {
  const [open, setOpen] = useState(false);
  const pending = !resolution && !expired;
  const allowed = resolution?.decision === "allow";

  return (
    <div
      data-testid="approval-card"
      data-state={resolution ? "resolved" : expired ? "expired" : "pending"}
      className={cn(
        "my-1 flex max-w-xl flex-col gap-2 rounded-card border p-3",
        pending
          ? "border-accent-warning bg-accent-warning-transparent"
          : "border-surface-border-primary bg-surface-secondary",
      )}
    >
      <div className="flex items-center gap-1.5 text-caption1 text-text-secondary">
        <ShieldCheckIcon
          className={cn("size-3.5 shrink-0", pending && "text-accent-warning")}
        />
        <span className="font-semibold">Approval required</span>
        {agentName ? (
          <span className="min-w-0 truncate">· {agentName}</span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="break-words text-body2 font-semibold text-text-primary">
          {title}
        </p>
        {subtitle && (
          <p className="break-all font-mono text-caption1 text-text-secondary">
            {subtitle}
          </p>
        )}
      </div>
      {detail !== undefined && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-caption1 text-text-secondary hover:text-text-primary"
            aria-expanded={open}
          >
            {open ? "Hide details ▾" : "Show details ▸"}
          </button>
          {open && (
            <pre className="scrollbar-custom mt-1 max-h-60 overflow-auto rounded-utility bg-surface-primary p-2 font-mono text-caption1">
              {detail}
            </pre>
          )}
        </div>
      )}
      {resolution ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-body2 font-medium",
            allowed ? "text-accent-success" : "text-accent-danger",
          )}
        >
          {allowed ? (
            <CircleCheckIcon className="size-4 shrink-0" />
          ) : (
            <OctagonXIcon className="size-4 shrink-0" />
          )}
          <span>
            {allowed ? "Approved" : "Denied"} by{" "}
            <span>{resolution.respondedBy}</span>
            {resolution.respondedAt ? (
              <span
                className="font-normal text-text-tertiary"
                title={formatAbsoluteTime(resolution.respondedAt)}
              >
                {" · "}
                {formatRelativeTime(resolution.respondedAt, now)}
              </span>
            ) : null}
          </span>
        </p>
      ) : expired ? (
        <p className="flex items-center gap-1.5 text-body2 font-medium text-accent-danger">
          <OctagonXIcon className="size-4 shrink-0" />
          Expired: the agent stopped waiting for an answer
        </p>
      ) : null}
      {error && (
        <p role="alert" className="text-body2 text-accent-danger">
          {error}
        </p>
      )}
      {pending &&
        (blockedReason ? (
          <p className="text-body2 text-text-secondary">{blockedReason}</p>
        ) : options.length === 0 ? (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={sending}
              onClick={() => onRespond?.("allow")}
            >
              Allow
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={sending}
              onClick={() => onRespond?.("cancel")}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-1.5">
            {options.map((opt) => {
              const isReject = opt.kind.startsWith("reject");
              return (
                <Button
                  key={opt.optionId}
                  type="button"
                  size="sm"
                  variant={isReject ? "outline" : "default"}
                  disabled={sending}
                  onClick={() =>
                    onRespond?.(isReject ? "cancel" : "allow", opt.optionId)
                  }
                  className="h-auto min-h-8 w-full justify-start whitespace-normal break-words py-1.5 text-left"
                >
                  {opt.name}
                </Button>
              );
            })}
          </div>
        ))}
    </div>
  );
}
