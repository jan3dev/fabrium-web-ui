// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/lib/parseSearchOperators.ts. Modified.
/**
 * Parse search operators out of a free-text query: `from:@user` and `in:#room`.
 *
 * Remaining text is the server-side search term. Name resolution for `from:` /
 * `in:` happens at the call site; this module only splits syntax.
 *
 * Operators must start at a token boundary (start of string or whitespace). A
 * word-boundary `\b` is intentionally avoided: it also matches after `-` / `/`,
 * which would turn `built-in:react` or `https://x.com/in:foo` into operators.
 */

export type ParsedSearchOperators = {
  /** Search term with operators removed. */
  text: string;
  /** Raw `from:` value (@user:server, @name, name), if present. */
  from: string | null;
  /** Raw `in:` value (#name, room ID, alias), if present. */
  in: string | null;
};

/** Token-start only — not `\b`, which fires after hyphens and slashes. */
const OPERATOR_RE = /(?:^|\s)(from|in):(\S+)/gi;

/** Drop trailing punctuation so `in:general,` still resolves to `general`. */
function cleanOperatorValue(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

/** Extract `from:` / `in:` operators from `raw`. Later occurrences of the same operator win. */
export function parseSearchOperators(raw: string): ParsedSearchOperators {
  let from: string | null = null;
  let inValue: string | null = null;

  const kept: string[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(OPERATOR_RE)) {
    const index = match.index ?? 0;
    kept.push(raw.slice(lastIndex, index));
    lastIndex = index + match[0].length;

    const value = cleanOperatorValue(match[2]);
    if (match[1].toLowerCase() === "from") from = value;
    else inValue = value;
  }

  kept.push(raw.slice(lastIndex));

  return {
    text: kept.join("").replace(/\s+/g, " ").trim(),
    from,
    in: inValue,
  };
}

/** Strip a leading `@` from a `from:` value. */
export function normalizeFromHandle(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

/** Strip a leading `#` from an `in:` value. */
export function normalizeInRoom(value: string): string {
  return value.startsWith("#") ? value.slice(1) : value;
}
