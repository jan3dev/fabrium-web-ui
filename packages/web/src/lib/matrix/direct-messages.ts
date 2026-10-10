import type { MatrixClient } from "matrix-js-sdk";

type DirectMap = Record<string, string[]>;

function directMap(client: MatrixClient): DirectMap {
  return (client.getAccountData("m.direct")?.getContent() ?? {}) as DirectMap;
}

/** A joined DM with `userId` from `m.direct`, newest first, or null. */
export function findDirectRoom(client: MatrixClient, userId: string): string | null {
  const ids = directMap(client)[userId] ?? [];
  return [...ids].reverse().find((id) => client.getRoom(id)?.getMyMembership() === "join") ?? null;
}

/** Creates a DM with `userIds` and files it under the first of them in `m.direct`. */
export async function createDirectRoom(client: MatrixClient, userIds: string[]): Promise<string> {
  const created = await (
    client as unknown as {
      createRoom: (opts: Record<string, unknown>) => Promise<{ room_id: string }>;
    }
  ).createRoom({
    is_direct: true,
    preset: "trusted_private_chat",
    invite: userIds,
  });
  const existing = directMap(client);
  const key = userIds[0]!;
  await (
    client as unknown as {
      setAccountData: (t: string, c: Record<string, unknown>) => Promise<unknown>;
    }
  ).setAccountData("m.direct", { ...existing, [key]: [...(existing[key] ?? []), created.room_id] });
  return created.room_id;
}
