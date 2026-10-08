// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MentionAutocomplete.tsx. Modified.
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

/**
 * The popover list every composer autocomplete shares: opens above the
 * composer, keeps the editor focused (mousedown is prevented), scrolls the
 * active option into view.
 */
export function SuggestionList<T>({
  label,
  items,
  selectedIndex,
  getKey,
  onSelect,
  onHover,
  children,
}: {
  label: string;
  items: readonly T[];
  selectedIndex: number;
  getKey: (item: T) => string;
  onSelect: (item: T) => void;
  onHover?: (index: number) => void;
  children: (item: T, active: boolean) => React.ReactNode;
}) {
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView?.({
      block: "nearest",
    });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={label}
      className="max-h-56 w-full overflow-y-auto rounded-card border border-border bg-popover p-1 text-popover-foreground shadow-modal"
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <li
          key={getKey(item)}
          role="option"
          aria-selected={index === selectedIndex}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-utility px-2.5 py-1.5 text-body2",
            index === selectedIndex
              ? "bg-surface-selected"
              : "hover:bg-surface-secondary",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item);
          }}
          onMouseEnter={() => onHover?.(index)}
        >
          {children(item, index === selectedIndex)}
        </li>
      ))}
    </ul>
  );
}

export type MentionSuggestion = {
  userId: string;
  displayName: string;
  isAgent: boolean;
};

/** `@` suggestions: agents first, then people. */
export function MentionAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  onHover,
}: {
  suggestions: readonly MentionSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: MentionSuggestion) => void;
  onHover?: (index: number) => void;
}) {
  return (
    <SuggestionList
      label="Mention suggestions"
      items={suggestions}
      selectedIndex={selectedIndex}
      getKey={(s) => s.userId}
      onSelect={onSelect}
      onHover={onHover}
    >
      {(s) => (
        <>
          <UserAvatar userId={s.userId} size="xs" />
          <span className="min-w-0 truncate font-medium" title={s.displayName}>
            {s.displayName}
          </span>
          {s.isAgent ? <Badge tone="agent">Agent</Badge> : null}
          <span className="ml-auto min-w-0 truncate text-caption1 text-text-tertiary">
            {s.userId}
          </span>
        </>
      )}
    </SuggestionList>
  );
}
