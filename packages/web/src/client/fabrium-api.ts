// Client for the Fabrium service API (VM management). The zooid daemon serves it
// under /_fabrium/v1 and checks a Matrix OpenID token; see FABRIUM_WEB_UI_PLAN.md, section 5.
import type { MatrixClient } from "matrix-js-sdk";
import type {
  CreateVmRequest,
  Vm,
  VmAccess,
  VmAgent,
  VmInstanceType,
} from "../model/types";
import { MatrixClientPeg } from "./peg";

const PREFIX = "/_fabrium/v1";
// A cached token is renewed this long before it expires.
const EXPIRY_MARGIN_MS = 30_000;

let baseUrl = "";

/** Sets the API origin from `fabrium_api_url` in /config.json. Empty means the page's own origin. */
export function setFabriumApiUrl(url: string | undefined): void {
  baseUrl = (url ?? "").replace(/\/+$/, "");
}

export class FabriumApiError extends Error {
  readonly status: number;
  /** The admission step that failed, on a 502 from a create. */
  readonly step?: string;

  constructor(status: number, message: string, step?: string) {
    super(message);
    this.name = "FabriumApiError";
    this.status = status;
    this.step = step;
  }
}

/** 403 means the user is not an admin or an owner. 404 means VM management is off. */
export function isNoAccess(e: unknown): boolean {
  return e instanceof FabriumApiError && (e.status === 403 || e.status === 404);
}

let token: { client: MatrixClient; expiresAt: number; value: Promise<string> } | null = null;

function accessToken(client: MatrixClient, renew: boolean): Promise<string> {
  if (!renew && token?.client === client && Date.now() < token.expiresAt) {
    return token.value;
  }
  const entry = {
    client,
    // Callers that arrive while the request is in flight share it.
    expiresAt: Infinity,
    value: client.getOpenIdToken().then((t) => {
      entry.expiresAt = Date.now() + t.expires_in * 1000 - EXPIRY_MARGIN_MS;
      return t.access_token;
    }),
  };
  token = entry;
  entry.value.catch(() => {
    if (token === entry) token = null;
  });
  return entry.value;
}

async function toError(res: Response): Promise<FabriumApiError> {
  const body: unknown = await res.json().catch(() => null);
  const { error, step } = (body && typeof body === "object" ? body : {}) as {
    error?: unknown;
    step?: unknown;
  };
  return new FabriumApiError(
    res.status,
    typeof error === "string" && error ? error : `Request failed (${res.status})`,
    typeof step === "string" ? step : undefined,
  );
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const client = MatrixClientPeg.safeGet();
  if (!client) throw new FabriumApiError(401, "Not signed in");
  const send = async (renew: boolean) =>
    fetch(`${baseUrl}${PREFIX}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await accessToken(client, renew)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send(false);
  if (res.status === 401) res = await send(true);
  if (!res.ok) throw await toError(res);
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // A host that does not serve the API often answers with its index page.
    throw new FabriumApiError(res.status, "Unexpected response");
  }
}

const vmPath = (id: string, verb = "") => `/vms/${encodeURIComponent(id)}${verb}`;

export const getAccess = () => call<VmAccess>("GET", "/access");
export const listVms = () => call<Vm[]>("GET", "/vms");
export const listInstanceTypes = () => call<VmInstanceType[]>("GET", "/instance-types");
export const listAgents = () => call<VmAgent[]>("GET", "/agents");
export const createVm = (req: CreateVmRequest) => call<Vm>("POST", "/vms", req);
export const startVm = (id: string) => call<Vm>("POST", vmPath(id, "/start"));
export const stopVm = (id: string) => call<Vm>("POST", vmPath(id, "/stop"));
export const rebootVm = (id: string) => call<Vm>("POST", vmPath(id, "/reboot"));
export const deleteVm = (id: string) => call<void>("DELETE", vmPath(id));
