import { WarningIcon } from "@/components/icons";

export function SendingIndicator() {
  return <span className="text-caption2 text-text-tertiary">Sending…</span>;
}

/** Failure line for a send the server rejected; Retry reuses its txnId. */
export function SendFailure({
  reason,
  onRetry,
  onDelete,
}: {
  reason: string;
  onRetry: () => void;
  onDelete: () => void;
}) {
  return (
    <div role="alert" className="mt-1 flex flex-wrap items-center gap-x-2 text-caption1 text-accent-danger">
      <WarningIcon className="size-3.5 shrink-0" />
      <span className="font-medium">Not sent</span>
      <span className="text-text-secondary">· {reason}</span>
      <span className="flex items-center gap-2 whitespace-nowrap">
        <button type="button" onClick={onRetry} className="font-medium text-text-primary hover:underline">
          Retry
        </button>
        <button type="button" onClick={onDelete} className="text-text-secondary hover:underline">
          Delete
        </button>
      </span>
    </div>
  );
}
