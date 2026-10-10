import { AuthCard } from "@/components/auth/auth-card";

const CODE =
  "rounded-utility bg-surface-secondary px-1 py-0.5 font-mono text-caption1";
const BLOCK =
  "rounded-utility bg-surface-secondary px-3 py-2 font-mono text-caption1 leading-5";

export function BootstrapError({ error }: { error: unknown }) {
  const isNoHomeserver =
    error instanceof Error && error.message.includes("No homeserver URL");

  return (
    <AuthCard
      className="max-w-md"
      title={isNoHomeserver ? "Homeserver not configured" : "Startup error"}
      description={
        isNoHomeserver
          ? "The app needs a Matrix homeserver URL before it can start."
          : "The app failed to start. Check the browser console for details."
      }
    >
      {isNoHomeserver ? (
        <>
          <p className="text-body2 text-text-secondary">
            Set the homeserver URL in one of the following ways:
          </p>
          <ol className="flex list-decimal flex-col gap-3 pl-4 text-body2">
            <li>
              <span className="font-medium">Build-time env var</span> — add to{" "}
              <code className={CODE}>.env.local</code>:
              <pre className={`mt-1.5 ${BLOCK}`}>
                VITE_MATRIX_HOMESERVER_URL=https://matrix.org
              </pre>
            </li>
            <li>
              <span className="font-medium">Runtime config</span> — create{" "}
              <code className={CODE}>public/config.json</code>:
              <pre
                className={`mt-1.5 ${BLOCK}`}
              >{`{ "homeserver_url": "https://matrix.org" }`}</pre>
            </li>
          </ol>
          <p className="text-caption1 text-text-secondary">
            Restart <code className={CODE}>pnpm dev</code> after setting the env
            var.
          </p>
        </>
      ) : (
        <pre className={`overflow-auto text-accent-danger ${BLOCK}`}>
          {String(error instanceof Error ? error.message : error)}
        </pre>
      )}
    </AuthCard>
  );
}
