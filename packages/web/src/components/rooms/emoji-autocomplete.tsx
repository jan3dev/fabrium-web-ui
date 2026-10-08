// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/EmojiAutocomplete.tsx. Modified.
import { SuggestionList } from "./mention-autocomplete";

export type EmojiSuggestion = { id: string; native: string };

type EmojiData = {
  emojis: Record<
    string,
    { id: string; keywords?: string[]; skins: { native: string }[] }
  >;
};

let emojiData: Promise<EmojiData> | null = null;

/** emoji-mart's data is large: load it on the first `:` query, once. */
export function loadEmojiData(): Promise<EmojiData> {
  emojiData ??= import("@emoji-mart/data").then((m) => m.default as EmojiData);
  return emojiData;
}

/** Shortcodes starting with the query first, then ones containing it or a keyword. */
export function searchEmoji(
  data: EmojiData,
  query: string,
  limit = 8,
): EmojiSuggestion[] {
  const q = query.toLowerCase();
  const starts: EmojiSuggestion[] = [];
  const contains: EmojiSuggestion[] = [];
  for (const e of Object.values(data.emojis)) {
    const native = e.skins[0]?.native;
    if (!native) continue;
    if (e.id.startsWith(q)) starts.push({ id: e.id, native });
    else if (e.id.includes(q) || e.keywords?.some((k) => k.startsWith(q))) {
      contains.push({ id: e.id, native });
    }
  }
  return [...starts, ...contains].slice(0, limit);
}

/** `:shortcode` suggestions. */
export function EmojiAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
}: {
  suggestions: readonly EmojiSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: EmojiSuggestion) => void;
  onHover?: (index: number) => void;
}) {
  return (
    <SuggestionList
      label="Emoji suggestions"
      items={suggestions}
      selectedIndex={selectedIndex}
      getKey={(s) => s.id}
      onSelect={onSelect}
      onHover={onHover}
    >
      {(s) => (
        <>
          <span className="text-subtitle leading-none">{s.native}</span>
          <span className="truncate text-text-secondary">:{s.id}:</span>
        </>
      )}
    </SuggestionList>
  );
}
