/**
 * Explicit mode (spec §6.8): the user asks for a kind of artifact from the composer's
 * Create menu or a slash command. The message carries `dev.fabrium.artifact_hint: { type }`
 * for the daemon and a plain-text line for every other client.
 */

export const ARTIFACT_HINT_FIELD = "dev.fabrium.artifact_hint";

/** Menu order. Whiteboard and Motion are level-5 kinds: the hint goes out, the agent says it cannot make them yet. */
export const CREATE_TYPES = [
  { type: "slides", label: "Slides", description: "A slide deck" },
  { type: "design", label: "Design", description: "Screens or a prototype" },
  { type: "design-system", label: "Design system", description: "Colors, type and components" },
  { type: "whiteboard", label: "Whiteboard", description: "Not available yet", later: true },
  { type: "motion", label: "Motion", description: "Not available yet", later: true },
] as const;

export type CreateType = (typeof CREATE_TYPES)[number]["type"];

export const createLabel = (type: CreateType) => CREATE_TYPES.find((t) => t.type === type)!.label;

const COMMAND = /^\/([a-z-]+)(?:\s+|$)/i;

/** `/slides make a deck about…` → the type and the rest; null for any other text. */
export function parseCreateCommand(text: string): { type: CreateType; rest: string } | null {
  const m = COMMAND.exec(text.trimStart());
  const type = CREATE_TYPES.find((t) => t.type === m?.[1]?.toLowerCase())?.type;
  return m && type ? { type, rest: text.trimStart().slice(m[0].length).trim() } : null;
}

/** Drops a leading `/command` from a message body or its HTML (inside a leading `<p>`). */
export function stripCreateCommand(text: string): string {
  return text.replace(/^(\s*(?:<p>)?)\s*\/[a-z-]+(?:\s+|(?=<)|$)/i, "$1");
}

/** The plain-text line other clients show; the agent reads it too. */
export const createLine = (type: CreateType) => `Create: ${createLabel(type)}`;
