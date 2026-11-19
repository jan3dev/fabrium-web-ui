import { useEffect, useState } from "react";
import { FabriumApiError, getAccess } from "../client/fabrium-api";
import type { FabriumRole } from "../model/types";

/** The wait before each retry of a failed check. When they run out, only focus asks again. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];

/**
 * A failure that may pass: a 5xx from the daemon, or no answer at all (network
 * error, failed OpenID request). Any other answer is final: 403, 404, or a page
 * where JSON should be.
 */
const isTransient = (e: unknown) => !(e instanceof FabriumApiError) || e.status >= 500;

/**
 * The role of the user from `GET /access`; `null` until it answers, and after a final
 * "no" (403, 404, no API). A transient failure is retried a few times, then on each
 * window focus, so no reload is needed.
 */
export function useFabriumRole(): FabriumRole | null {
  const [role, setRole] = useState<FabriumRole | null>(null);

  useEffect(() => {
    let alive = true;
    // The last check failed in a transient way and no request is in flight.
    let failed = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      clearTimeout(timer);
      failed = false;
      getAccess().then(
        (access) => {
          if (alive) setRole(access.role);
        },
        (e) => {
          if (!alive || !isTransient(e)) return;
          failed = true;
          if (retries < RETRY_MS.length) timer = setTimeout(check, RETRY_MS[retries++]);
        },
      );
    };
    const onFocus = () => {
      if (failed) check();
    };

    check();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return role;
}
