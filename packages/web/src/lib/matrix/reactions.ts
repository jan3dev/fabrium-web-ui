import type { MatrixClient } from "matrix-js-sdk";

/** Sends an `m.reaction` with `key` on `eventId`. */
export function sendReaction(client: MatrixClient, roomId: string, eventId: string, key: string): Promise<unknown> {
  const send = client.sendEvent as unknown as (room: string, type: string, content: Record<string, unknown>) => Promise<unknown>;
  return send.call(client, roomId, "m.reaction", {
    "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key },
  });
}
