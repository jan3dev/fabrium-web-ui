import { WarningIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { PreviewStatus } from "@/model/types";
import { logTail } from "./preview-console";

function LogTail({ log, lines }: { log: string; lines: number }) {
  const tail = logTail(log, lines);
  if (!tail) return null;
  return (
    <pre className="max-h-64 w-full max-w-2xl overflow-auto rounded-utility bg-surface-secondary px-3 py-2 text-left font-mono text-caption1 leading-5 whitespace-pre-wrap text-text-secondary">
      {tail}
    </pre>
  );
}

/**
 * What covers the app frame while the app is not running, so the user never
 * looks at a blank frame. Renders nothing for a running app.
 */
export function PreviewState({
  status,
  title,
  agentName,
  exitCode,
  since,
  log,
  onRestart,
  onStop,
  onAskFix,
}: {
  status: PreviewStatus;
  title: string;
  agentName: string;
  exitCode: number | null;
  /** RFC 3339: when the app entered this status. */
  since: string;
  log: string;
  /** Absent: the viewer may not restart (agents never get the buttons). */
  onRestart?: () => void;
  onStop?: () => void;
  /** Crashed only: put the log tail into the thread composer for the agent. */
  onAskFix?: () => void;
}) {
  if (status === "running") return null;
  const time = new Date(since);
  const at = Number.isNaN(time.getTime())
    ? null
    : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      data-testid="preview-state"
      data-status={status}
      role="status"
      aria-live="polite"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-background p-6 text-center"
    >
      {status === "starting" ? (
        <>
          <Spinner size="medium" aria-hidden className="text-text-tertiary" />
          <p className="text-body1 font-medium text-text-primary">Starting {title}…</p>
          <LogTail log={log} lines={5} />
          {onStop ? (
            <Button variant="outline" size="sm" onClick={onStop}>
              Stop
            </Button>
          ) : null}
        </>
      ) : status === "crashed" ? (
        <>
          <WarningIcon className="size-5 text-accent-danger" />
          <p className="text-body1 font-medium text-text-primary">
            {exitCode === null ? "App stopped" : `App stopped (exit ${exitCode})`}
          </p>
          <LogTail log={log} lines={20} />
          <div className="flex gap-2">
            {onRestart ? (
              <Button size="sm" onClick={onRestart}>
                Restart app
              </Button>
            ) : null}
            {onAskFix ? (
              <Button variant="outline" size="sm" onClick={onAskFix}>
                Ask agent to fix
              </Button>
            ) : null}
          </div>
        </>
      ) : status === "stopped" ? (
        <>
          <p className="text-body1 font-medium text-text-primary">
            {at ? `App stopped at ${at}` : "App stopped"}
          </p>
          {onRestart ? (
            <Button size="sm" onClick={onRestart}>
              Restart app
            </Button>
          ) : null}
        </>
      ) : (
        <p className="text-body1 font-medium text-text-primary">
          {agentName}'s workstation is offline
        </p>
      )}
    </div>
  );
}
