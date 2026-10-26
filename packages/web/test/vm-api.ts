// Test setup for code that calls the Fabrium service API.
import { vi } from "vitest";
import { MatrixClientPeg } from "../src/client/peg";
import { makeFakeClient } from "./factories";

/**
 * Signs in a fake Matrix client. Its OpenID requests hand out `tokens` in
 * order. A new client per test also gives the API client a fresh token cache.
 */
export function signInForVmApi(
  tokens: string[] = ["tok-1", "tok-2", "tok-3"],
  expiresIn = 3600,
) {
  const client = makeFakeClient({ userId: "@ann:example.org" });
  let issued = 0;
  const getOpenIdToken = vi.fn(async () => ({
    access_token: tokens[issued++] ?? `tok-${issued}`,
    token_type: "Bearer",
    matrix_server_name: "example.org",
    expires_in: expiresIn,
  }));
  Object.assign(client, { getOpenIdToken });
  MatrixClientPeg.injectClientForTest(client);
  return { client, getOpenIdToken };
}
