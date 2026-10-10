import { WarningIcon } from "@/components/icons";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DecodedZooidEvent } from "../../events/zooid-events";

type ErrorDecoded = Extract<DecodedZooidEvent, { kind: "error" }>;

/** An agent error. Transient ones (rate limits, restarts) read as a warning. */
export function ErrorTile({ decoded }: { decoded: ErrorDecoded }) {
  const handleCopy = () => {
    const payload: Record<string, unknown> = {
      code: decoded.code,
      message: decoded.message,
    };
    if (decoded.detail) payload.detail = decoded.detail;
    if (decoded.acpError) payload.acp_error = decoded.acpError;
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  return (
    <Alert tone={decoded.transient ? "warning" : "danger"} className="my-1 max-w-xl p-3" data-testid="agent-error">
      <WarningIcon />
      <div className="min-w-0 flex-1">
        <AlertTitle className="mb-0 break-words">{decoded.message}</AlertTitle>
        {decoded.detail && (
          <details className="mt-1">
            <summary className="cursor-pointer text-caption1 text-text-secondary">details</summary>
            <pre className="scrollbar-custom mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-caption1">
              {decoded.detail}
            </pre>
          </details>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="xs" variant="outline" onClick={handleCopy}>
            Copy details
          </Button>
          {decoded.recovery && (
            <Button asChild size="xs" variant="outline">
              <a href={decoded.recovery} target="_blank" rel="noreferrer">
                Learn more
              </a>
            </Button>
          )}
        </div>
      </div>
    </Alert>
  );
}
