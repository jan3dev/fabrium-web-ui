import DOMPurify from "dompurify";
import { Marked } from "marked";
import { expandMentions } from "../sender";

/** A `@Label` or `#Label` picked from autocomplete, and what it points at. */
export interface ComposedLink {
  label: string;
  /** A Matrix user ID for `@`, a room ID for `#`. */
  target: string;
}

export interface ComposedText {
  body: string;
  /** Set only when the Markdown renders to more than paragraphs and line breaks. */
  formattedBody?: string;
  mentionUserIds: string[];
}

// Its own instance: zooid-event.tsx configures the shared `marked` differently.
const markdown = new Marked({ gfm: true, breaks: true });

const permalink = (id: string) => `https://matrix.to/#/${id}`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace each `<prefix>Label` token, longest label first so "Coder · Payments" beats "Coder". */
function replaceTokens(
  text: string,
  prefix: "@" | "#",
  links: readonly ComposedLink[],
  to: (link: ComposedLink) => string,
  used: Set<ComposedLink>,
): string {
  const sorted = [...links].sort((a, b) => b.label.length - a.label.length);
  if (sorted.length === 0) return text;
  const byLabel = new Map(sorted.map((l) => [l.label.toLowerCase(), l]));
  const pattern = new RegExp(
    `(^|[\\s(])${prefix}(${sorted.map((l) => escapeRegExp(l.label)).join("|")})(?=\\W|$)`,
    "gi",
  );
  return text.replace(pattern, (_whole, pre: string, label: string) => {
    const link = byLabel.get(label.toLowerCase())!;
    used.add(link);
    return pre + to(link);
  });
}

/**
 * The composer's Markdown as Matrix message fields. In `body` a picked mention
 * becomes the bare user ID (the daemon routes on it and strips it from the
 * agent's prompt) and a picked room its matrix.to link. In `formatted_body`
 * both become matrix.to pills. `@localpart` typed by hand still resolves
 * against the room's members.
 */
export function composeText(
  markdownText: string,
  {
    mentions = [],
    rooms = [],
    members = [],
  }: {
    mentions?: readonly ComposedLink[];
    rooms?: readonly ComposedLink[];
    members?: ReadonlyArray<{ userId: string }>;
  } = {},
): ComposedText {
  const used = new Set<ComposedLink>();
  const plain = replaceTokens(
    replaceTokens(markdownText, "@", mentions, (l) => l.target, used),
    "#",
    rooms,
    (l) => permalink(l.target),
    used,
  );
  const { body, userIds } = expandMentions(plain, members);
  for (const l of used)
    if (mentions.includes(l) && !userIds.includes(l.target))
      userIds.push(l.target);

  const linked = replaceTokens(
    replaceTokens(
      markdownText,
      "@",
      mentions,
      (l) => `[${l.label}](${permalink(l.target)})`,
      new Set(),
    ),
    "#",
    rooms,
    (l) => `[#${l.label}](${permalink(l.target)})`,
    new Set(),
  );
  const html = DOMPurify.sanitize(
    markdown.parse(expandMentions(linked, members).body, { async: false }),
  ).trim();
  // Only paragraphs and line breaks: the plain body says the same.
  const formatted = /<(?!\/?p>|br\s*\/?>)/i.test(html);

  return formatted
    ? { body, formattedBody: html, mentionUserIds: userIds }
    : { body, mentionUserIds: userIds };
}
