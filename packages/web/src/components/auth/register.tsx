import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MatrixClientPeg } from "../../client/peg";
import { registerWithPassword, registrationSupported } from "../../client/register";
import { AuthCard } from "./auth-card";

export function Register({ homeserverUrl }: { homeserverUrl: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [requiresToken, setRequiresToken] = useState(false);
  const [token, setToken] = useState(params.get("token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    registrationSupported(homeserverUrl)
      .then((s) => setRequiresToken(s.requiresToken))
      .catch(() => {});
  }, [homeserverUrl]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const creds = await registerWithPassword(
        homeserverUrl,
        String(fd.get("username") ?? ""),
        String(fd.get("password") ?? ""),
        { token: token || undefined },
      );
      MatrixClientPeg.set(creds);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Create account">
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-username">Username</Label>
          <Input id="reg-username" name="username" autoComplete="username" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reg-password">Password</Label>
          <Input
            id="reg-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
        {requiresToken && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reg-token">Registration token</Label>
            <Input
              id="reg-token"
              name="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>
        )}
        <Button type="submit" variant="primary" className="mt-1" disabled={submitting}>
          Create account
        </Button>
      </form>
      <p className="text-center text-body2 text-text-secondary">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent-brand hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
