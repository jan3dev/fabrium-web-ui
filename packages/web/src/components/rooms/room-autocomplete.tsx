// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/ChannelAutocomplete.tsx. Modified.
import { HashIcon } from "@/components/icons";
import { SuggestionList } from "./mention-autocomplete";

export type RoomSuggestion = { roomId: string; name: string };

/** `#` suggestions from the rooms I am in. */
export function RoomAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
}: {
  suggestions: readonly RoomSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: RoomSuggestion) => void;
  onHover?: (index: number) => void;
}) {
  return (
    <SuggestionList
      label="Room suggestions"
      items={suggestions}
      selectedIndex={selectedIndex}
      getKey={(s) => s.roomId}
      onSelect={onSelect}
      onHover={onHover}
    >
      {(s) => (
        <>
          <HashIcon className="size-4 shrink-0 text-text-tertiary" />
          <span className="min-w-0 truncate font-medium">{s.name}</span>
        </>
      )}
    </SuggestionList>
  );
}
