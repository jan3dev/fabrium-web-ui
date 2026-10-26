import { useEffect, useState } from "react";
import { getAccess } from "../client/fabrium-api";

/**
 * True once the API says this user can manage VMs. Any other answer keeps it
 * false: 403 for a member, 404 when VM management is off, or no API at all.
 */
export function useVmAccess(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    getAccess().then(
      () => setAllowed(true),
      () => {},
    );
  }, []);

  return allowed;
}
