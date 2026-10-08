// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/ui/SearchResultItem.tsx. Modified.
import { RoomGlyph } from "@/components/room-glyph";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import type { MessageSearchHit, MessageSearchStatus as MessageSearchStatusValue } from "@/hooks/use-message-search";
import { buildSearchResultPreview } from "@/lib/search/search-match";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { HighlightedText } from "./highlighted-text";

export interface RoomResult {
  roomId: string;
  name: string;
  topic?: string;
  isDm: boolean;
  /** The other member of a DM. */
  dmUserId?: string | null;
  isPrivate?: boolean;
  /** False for a public room the viewer has not joined. */
  joined: boolean;
}

export type SearchResult =
  | { kind: "room"; room: RoomResult }
  | { kind: "message"; hit: MessageSearchHit }
  | { kind: "action"; id: "see-all"; title: string };

export function resultKey(result: SearchResult): string {
  if (result.kind === "room") return `room-${result.room.roomId}`;
  if (result.kind === "message") return `message-${result.hit.id}`;
  return `action-${result.id}`;
}

/** One search option: a room, a message hit with its highlighted excerpt, or an action. */
export function SearchResultRow({
  result,
  query,
  index,
  isSelected,
  onSelect,
  onMouseEnter,
}: {
  result: SearchResult;
  /** The term the result answers, operators removed. */
  query: string;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      aria-selected={isSelected}
      className={cn(
        "flex w-full gap-2.5 rounded-utility px-2.5 text-left transition-colors",
        result.kind === "message"
          ? "items-start py-2.5"
          : "items-center py-1.5",
        isSelected
          ? "bg-surface-secondary text-text-primary"
          : "hover:bg-surface-secondary",
      )}
      data-search-result-index={index}
      data-testid={`search-result-${resultKey(result)}`}
      onClick={onSelect}
      // Keep focus in the search field.
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      role="option"
      type="button"
    >
      {result.kind === "message" ? (
        <MessageResultBody hit={result.hit} query={query} />
      ) : result.kind === "room" ? (
        <RoomResultBody room={result.room} />
      ) : (
        <span className="text-body2 text-text-secondary">{result.title}</span>
      )}
    </button>
  );
}

function RoomResultBody({ room }: { room: RoomResult }) {
  return (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center text-text-tertiary">
        <RoomGlyph
          kind={room.isDm ? "dm" : "stream"}
          dmUserId={room.dmUserId}
          isPrivate={room.isPrivate}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body2 font-medium">
          {room.name}
        </span>
        {room.topic ? (
          <span className="block truncate text-caption1 text-text-tertiary">
            {room.topic}
          </span>
        ) : null}
      </span>
      {room.joined ? null : (
        <span className="shrink-0 text-caption2 text-text-tertiary">
          Not joined
        </span>
      )}
    </>
  );
}

function MessageResultBody({
  hit,
  query,
}: {
  hit: MessageSearchHit;
  query: string;
}) {
  return (
    <>
      <UserAvatar userId={hit.author.id} size="sm" className="mt-0.5" />
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3">
        <span className="truncate text-body2 font-semibold">
          {hit.author.displayName}
        </span>
        <span className="text-caption1 text-text-tertiary">
          {formatRelativeTime(hit.createdAt, Date.now())}
        </span>
        <span className="col-span-2 truncate text-caption1 text-text-tertiary">
          {hit.threadRootId ? "Thread in " : "Message in "}
          <span className="font-medium text-text-secondary">
            #{hit.roomName}
          </span>
        </span>
        <span className="col-span-2 mt-0.5 truncate text-body2 text-text-secondary">
          <HighlightedText
            query={query}
            text={buildSearchResultPreview(hit.body, query)}
          />
        </span>
      </span>
    </>
  );
}

export function SearchResultsSkeleton() {
  return (
    <div aria-hidden className="p-1" data-testid="search-results-loading">
      {["w-48", "w-72", "w-60"].map((width) => (
        <div className="flex items-start gap-2.5 px-2.5 py-2.5" key={width}>
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className={cn("mt-1.5 h-3 max-w-full", width)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** What the Messages section shows while it has no hits. */
export function MessageSearchStatus({
  status,
  error,
  term,
  className,
}: {
  status: MessageSearchStatusValue;
  error: string | null;
  term: string;
  className?: string;
}) {
  if (status === "loading" || status === "idle")
    return <SearchResultsSkeleton />;
  const text =
    status === "unsupported"
      ? "Search is not supported by this server."
      : status === "error"
        ? (error ?? "Search failed.")
        : `No messages match “${term}”.`;
  return (
    <p
      className={cn(
        "px-2.5 py-2 text-body2",
        status === "error" ? "text-accent-danger" : "text-text-tertiary",
        className,
      )}
    >
      {text}
    </p>
  );
}
