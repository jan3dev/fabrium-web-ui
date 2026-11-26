/**
 * Explicit mode (spec §6.8): the user asks for a kind of artifact from the composer's
 * Create menu or a slash command. The message carries `dev.fabrium.artifact_hint: { type }`
 * for the daemon and a plain-text line for every other client.
 */

export const ARTIFACT_HINT_FIELD = "dev.fabrium.artifact_hint";

/** Menu order. */
export const CREATE_TYPES = [
  { type: "slides", label: "Slides", description: "A slide deck" },
  { type: "design", label: "Design", description: "Screens or a prototype" },
  { type: "design-system", label: "Design system", description: "Colors, type and components" },
  { type: "whiteboard", label: "Whiteboard", description: "Notes, shapes and links on a board" },
  { type: "motion", label: "Motion", description: "An animation in scenes" },
] as const;

export type CreateType = (typeof CREATE_TYPES)[number]["type"];

export const createLabel = (type: CreateType) => CREATE_TYPES.find((t) => t.type === type)!.label;

/** Example prompts (spec §3.1), offered while the composer is empty; one fills the field. */
export const CREATE_EXAMPLES: Record<CreateType, readonly string[]> = {
  slides: [
    "A 10-slide pitch deck for a seed round: problem, solution, market, traction, team and the ask",
    "A 5-slide project update for the leadership team, with one chart",
    "A short training deck from the notes in this thread",
  ],
  design: [
    "A sign-up flow for a phone in three screens: welcome, form and confirmation",
    "A pricing page with three plans, for desktop and phone",
    "A dashboard for support tickets: open count, response time and a ticket list",
  ],
  "design-system": [
    "A design system for a calm health app: colors, type, spacing and buttons",
    "A design system taken from the deck in this thread",
  ],
  whiteboard: [
    "A mind map of our launch plan, grouped by team",
    "A retro board: what went well, what did not, and actions",
  ],
  motion: [
    "A 10-second animated title for our product launch",
    "An animated bar chart of monthly sign-ups in three scenes",
  ],
};

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
