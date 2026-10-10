import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Alert } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { exchangeLoginToken } from "../../client/login";
import { MatrixClientPeg } from "../../client/peg";
import { AuthCard } from "./auth-card";

interface AuthCallbackProps {
  homeserverUrl: string;
}

export function AuthCallback({ homeserverUrl }: AuthCallbackProps) {
  const [params] = useSearchParams();
  const loginToken = params.get("loginToken");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!loginToken) return;
    exchangeLoginToken(homeserverUrl, loginToken)
      .then((creds) => {
        MatrixClientPeg.set(creds);
        setDone(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [homeserverUrl, loginToken]);

  if (!loginToken) return <Navigate to="/login" replace />;
  if (error)
    return (
      <AuthCard title="Sign-in failed">
        <Alert tone="danger">{error}</Alert>
        <Link to="/login" className="text-center text-body2 font-medium text-accent-brand hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  if (done) return <Navigate to="/" replace />;
  return (
    <Empty className="min-h-screen" role="status">
      <EmptyHeader>
        <EmptyMedia>
          <Spinner aria-label="Completing sign-in" />
        </EmptyMedia>
        <EmptyDescription>Completing sign-in…</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
