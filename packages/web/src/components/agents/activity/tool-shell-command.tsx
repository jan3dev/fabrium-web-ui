// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/AgentSessionToolItem/ShellCommandBlock.tsx. Modified.
import { TerminalIcon } from "@/components/icons";

export function ShellCommandBlock({ command, output }: { command: string; output: string | null }) {
  const stdout = output?.trimEnd();
  return (
    <div
      className="overflow-hidden rounded-utility bg-surface-secondary px-3 py-2 font-mono text-caption1"
      data-testid="transcript-shell-command"
    >
      <p className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-text-secondary">
        <TerminalIcon className="mr-2 inline size-3.5 align-[-0.1875rem] text-accent-brand" />
        {command}
      </p>
      {stdout ? (
        <pre className="scrollbar-custom mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-text-primary">
          {stdout}
        </pre>
      ) : null}
    </div>
  );
}
