// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/ui/useSearchMenuKeyboardNavigation.ts. Modified.
import * as React from "react";

/**
 * Arrow keys move through `count` options, Enter opens the selected one,
 * Backspace on an empty query drops the room scope. Options carry
 * `data-search-result-index` so the selected one scrolls into view.
 */
export function useSearchKeyboardNav({
  count,
  onOpen,
  onRemoveScope,
  query,
  scopeActive,
  selectedIndex,
  setSelectedIndex,
}: {
  count: number;
  onOpen: (index: number) => void;
  onRemoveScope: () => void;
  query: string;
  scopeActive: boolean;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
}) {
  React.useEffect(() => {
    setSelectedIndex((current) => (count === 0 ? 0 : Math.min(current, count - 1)));
  }, [count, setSelectedIndex]);

  React.useEffect(() => {
    document
      .querySelector<HTMLElement>(`[data-search-result-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace" && query.length === 0 && scopeActive) {
        event.preventDefault();
        onRemoveScope();
        return;
      }
      if (event.key === "ArrowDown" && count > 0) {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, count - 1));
        return;
      }
      if (event.key === "ArrowUp" && count > 0) {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter" && !event.nativeEvent.isComposing && count > 0) {
        event.preventDefault();
        onOpen(selectedIndex);
      }
    },
    [count, onOpen, onRemoveScope, query.length, scopeActive, selectedIndex, setSelectedIndex],
  );
}
