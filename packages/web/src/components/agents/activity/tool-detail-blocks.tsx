// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/AgentSessionToolItem/ToolDetailBlocks.tsx. Modified.
import { DiffView } from "@/components/timeline/diff-view";
import { Alert } from "@/components/ui/alert";
import { WarningIcon } from "@/components/icons";
import type { ToolSummary } from "@/lib/agent-activity/tool-summary";
import type { ToolTranscriptItem } from "@/model/agent-activity";
import { ShellCommandBlock } from "./tool-shell-command";

export function ToolDetailBlocks({
  item,
  summary,
  stalled,
}: {
  item: ToolTranscriptItem;
  summary: ToolSummary;
  stalled: boolean;
}) {
  const hasInput = item.rawInput !== null && Object.keys(item.rawInput).length > 0;
  const failed = item.status === "failed";
  return (
    <div className="space-y-2 py-1.5 pl-5">
      {stalled ? (
        <Alert tone="warning" className="p-2 text-caption1">
          <WarningIcon />
          <span>
            No updates for over 5 minutes. The tool may be stuck; send <code className="font-mono">/stop</code> in
            the thread to cancel.
          </span>
        </Alert>
      ) : null}
      {summary.shellCommand ? (
        <ShellCommandBlock command={summary.shellCommand} output={item.content} />
      ) : (
        <>
          {summary.diffs.length > 0 ? (
            summary.diffs.map((d, i) => <DiffView key={i} diff={d} />)
          ) : hasInput ? (
            <ToolCodeBlock label="Parameters" value={JSON.stringify(item.rawInput, null, 2)} />
          ) : null}
          {/* Plain text only: tool output carries web pages and command output, never trusted markup. */}
          {item.content ? <ToolCodeBlock label={failed ? "Error" : "Result"} danger={failed} value={item.content} /> : null}
        </>
      )}
      {!summary.shellCommand && !hasInput && summary.diffs.length === 0 && !item.content ? (
        <p className="text-caption1 text-text-tertiary">Waiting for tool details.</p>
      ) : null}
    </div>
  );
}

function ToolCodeBlock({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="space-y-1 overflow-hidden">
      <h4 className="text-caption2 font-semibold uppercase tracking-wide text-text-tertiary">{label}</h4>
      <pre
        className={
          "scrollbar-custom max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-utility px-3 py-2 font-mono text-caption1 " +
          (danger ? "bg-accent-danger-transparent text-accent-danger" : "bg-surface-secondary text-text-primary")
        }
      >
        {value}
      </pre>
    </div>
  );
}
