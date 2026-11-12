import { useEffect, useRef } from "react";
import { ChevronDownIcon, ChevronUpIcon, CopyIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { copyToClipboard } from "@/lib/browser-actions";
import { cn } from "@/lib/utils";

export type ConsoleTab = "console" | "logs";

/** The newest lines of the app output: what "Ask agent to fix" sends from the Logs tab. */
export function logTail(log: string, lines = 40): string {
  return log.trimEnd().split("\n").slice(-lines).join("\n");
}

/**
 * The drawer under the app frame. Console: errors the page reported through the
 * bridge. Logs: the app's stdout and stderr, live. Every entry can go to the
 * agent; `onAskFix` is absent when the viewer may not ask (no thread composer).
 */
export function PreviewConsole({
  log,
  errors,
  open,
  tab,
  onOpenChange,
  onTabChange,
  onAskFix,
}: {
  log: string;
  errors: readonly string[];
  open: boolean;
  tab: ConsoleTab;
  onOpenChange: (open: boolean) => void;
  onTabChange: (tab: ConsoleTab) => void;
  /** `where` names the source for the agent: "Console error" or "App log". */
  onAskFix?: (text: string, where: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Follow new output, like a terminal.
  useEffect(() => {
    if (open && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [log, errors, open, tab]);

  const latest = errors[errors.length - 1];
  const tabButton = (value: ConsoleTab, label: string, extra?: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={open && tab === value}
      aria-controls="preview-console-body"
      onClick={() => {
        if (open && tab === value) onOpenChange(false);
        else {
          onTabChange(value);
          onOpenChange(true);
        }
      }}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-utility px-1.5 py-1 text-caption1 font-medium hover:text-text-primary",
        open && tab === value ? "text-text-primary" : "text-text-secondary",
      )}
    >
      {label}
      {extra}
    </button>
  );

  return (
    <div data-testid="preview-console" className="shrink-0 border-t border-border">
      <div className="flex h-10 items-center gap-1 px-2">
        <IconButton
          size="small"
          icon={open ? <ChevronDownIcon /> : <ChevronUpIcon />}
          label={open ? "Hide console" : "Show console"}
          aria-expanded={open}
          aria-controls="preview-console-body"
          onClick={() => onOpenChange(!open)}
        />
        <div role="tablist" aria-label="Console" className="flex items-center gap-0.5">
          {tabButton(
            "console",
            "Console",
            errors.length > 0 ? (
              <Badge tone="danger" data-testid="preview-error-count">
                {errors.length === 1 ? "1 error" : `${errors.length} errors`}
              </Badge>
            ) : null,
          )}
          {tabButton("logs", "Logs")}
        </div>
        <div className="flex-1" />
        {open && tab === "logs" ? (
          <>
            {onAskFix && log ? (
              <Button size="xs" variant="utility" onClick={() => onAskFix(logTail(log), "App log")}>
                Ask agent to fix
              </Button>
            ) : null}
            <IconButton
              size="small"
              icon={<CopyIcon />}
              label="Copy logs"
              disabled={!log}
              onClick={() => copyToClipboard(log, "Logs copied")}
            />
          </>
        ) : onAskFix && latest ? (
          <Button size="xs" variant="utility" onClick={() => onAskFix(latest, "Console error")}>
            Ask agent to fix
          </Button>
        ) : null}
      </div>
      {open ? (
        <div
          id="preview-console-body"
          role="tabpanel"
          ref={scroller}
          tabIndex={0}
          aria-label={tab === "console" ? "Page errors" : "App logs"}
          className="h-48 overflow-auto bg-surface-secondary font-mono text-caption1 leading-5 text-text-secondary"
        >
          {tab === "logs" ? (
            <pre className="px-3 py-2 whitespace-pre-wrap">{log || "No output yet."}</pre>
          ) : errors.length === 0 ? (
            <p className="px-3 py-2 font-sans">No errors on this page.</p>
          ) : (
            <ul className="divide-y divide-border">
              {errors.map((e, i) => (
                <li key={i} className="flex items-start gap-2 px-3 py-1.5">
                  <pre className="min-w-0 flex-1 whitespace-pre-wrap text-accent-danger">{e}</pre>
                  {onAskFix ? (
                    <Button size="xs" variant="ghost" onClick={() => onAskFix(e, "Console error")}>
                      Ask agent to fix
                    </Button>
                  ) : null}
                  <IconButton
                    size="small"
                    icon={<CopyIcon />}
                    label="Copy error"
                    onClick={() => copyToClipboard(e, "Error copied")}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
