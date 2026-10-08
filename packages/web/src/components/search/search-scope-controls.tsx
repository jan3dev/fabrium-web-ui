// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/ui/SearchScopeControls.tsx. Modified.
import { CloseIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** "#general ×" inside the search field: the search covers one room until removed. */
export function SearchScopeChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      aria-label={`Remove ${label} search scope`}
      className="flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-utility bg-accent-brand-transparent px-1.5 text-caption1 font-medium text-text-primary transition-colors hover:bg-surface-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="search-room-scope-chip"
      // Keep focus in the search field.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRemove}
      type="button"
    >
      <span className="truncate">{label}</span>
      <CloseIcon className="size-3 shrink-0 text-text-tertiary" />
    </button>
  );
}

/** Leading option while in a room: narrow the search to it. */
export function CurrentRoomSearchAction({
  roomLabel,
  isDm,
  isSelected,
  onActivate,
  onMouseEnter,
}: {
  roomLabel: string;
  isDm: boolean;
  isSelected: boolean;
  onActivate: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <div className="p-1.5 pb-0">
      <button
        aria-selected={isSelected}
        className={cn(
          "flex w-full items-center gap-2 rounded-utility border border-surface-border-primary px-2.5 py-2 text-left text-body2 transition-colors",
          isSelected ? "bg-surface-secondary" : "hover:bg-surface-secondary",
        )}
        data-search-result-index="0"
        data-testid="search-current-room-action"
        onClick={onActivate}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={onMouseEnter}
        role="option"
        type="button"
      >
        <SearchIcon className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="min-w-0 truncate text-text-secondary">
          {isDm ? "Search conversation with " : "Search in "}
          <span className="font-medium text-text-primary">{roomLabel}</span>
        </span>
      </button>
    </div>
  );
}
