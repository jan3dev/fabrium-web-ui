import { useEffect, useState } from "react";
import { FabriumApiError, getAccess } from "../client/fabrium-api";

/** The wait before each retry of a failed check. When they run out, only focus asks again. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];

/**
 * A failure that may pass: a 5xx from the daemon, or no answer at all (network
 * error, failed OpenID request). Any other answer is final: 403, 404, or a page
 * where JSON should be.
 */
const isTransient = (e: unknown) => !(e instanceof FabriumApiError) || e.status >= 500;

/**
 * True once the API says this user can manage VMs. It stays false for a final
 * "no": 403 for a member, 404 when VM management is off, or no API at all. After
 * a transient failure the hook retries a few times, then again each time the
 * window regains focus, so the button does not stay hidden until a reload.
 */
export function useVmAccess(): boolean {
  const [allowed, setAllowed] = useState(false);

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
        () => {
          if (alive) setAllowed(true);
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

  return allowed;
}
