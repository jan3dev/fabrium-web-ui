// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/ui/HighlightedSearchText.tsx. Modified.
import * as React from "react";

import { splitSearchMatches } from "@/lib/search/search-match";

/** `text` with every lexeme matching `query` marked. */
export function HighlightedText({ query, text }: { query: string; text: string }) {
  return splitSearchMatches(text, query).map((part) =>
    part.isMatch ? (
      <mark
        className="rounded-xs bg-accent-warning-transparent text-text-primary"
        data-search-match="true"
        key={part.key}
      >
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={part.key}>{part.text}</React.Fragment>
    ),
  );
}
