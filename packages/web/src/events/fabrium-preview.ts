import type { MatrixEvent } from "matrix-js-sdk";
import type { PreviewEvent } from "@/model/types";

/** Key inside an `m.room.message` that marks a live app preview event. */
export const PreviewContentKey = "dev.fabrium.preview";

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type DecodedPreview = Pick<PreviewEvent, "name" | "title" | "command" | "kind" | "action">;

/** The preview fields of a message, or null when it is not a well-formed preview event. */
export function decodePreview(ev: MatrixEvent): DecodedPreview | null {
  if (ev.getType() !== "m.room.message") return null;
  const p = (ev.getContent() as Record<string, unknown>)[PreviewContentKey];
  if (!p || typeof p !== "object") return null;
  const { name, title, command, kind, action } = p as Record<string, unknown>;
  if (typeof name !== "string" || !NAME.test(name)) return null;
  if (action !== "started" && action !== "stopped") return null;
  return {
    name,
    title: typeof title === "string" && title ? title.slice(0, 200) : name,
    command: typeof command === "string" ? command.slice(0, 500) : "",
    // Missing or unknown = web: older daemons send no kind.
    kind: kind === "expo" ? "expo" : "web",
    action,
  };
}
