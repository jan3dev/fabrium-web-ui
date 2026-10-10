// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/search/ui/TopbarSearch.tsx. Modified.
import * as React from "react";
import { useMatch, useNavigate } from "react-router-dom";

import { SearchIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useDirectRooms } from "@/hooks/use-direct-rooms";
import { messageHitPath, useMessageSearch } from "@/hooks/use-message-search";
import { usePublicRooms } from "@/hooks/use-public-rooms";
import { useRoomList } from "@/hooks/use-room-list";
import { getPlatformKeysById } from "@/lib/keyboard-shortcuts";
import { parseSearchOperators } from "@/lib/search/parse-search-operators";
import {
  type RoomResult,
  type SearchResult,
  SearchResultRow,
  MessageSearchStatus,
  resultKey,
} from "./search-result-item";
import {
  CurrentRoomSearchAction,
  SearchScopeChip,
} from "./search-scope-controls";
import { useSearchKeyboardNav } from "./use-search-keyboard-nav";

const MAX_SUGGESTIONS = 4;
const MAX_ROOMS = 5;
const MAX_MESSAGES = 8;
const SECTION_TITLE_CLASS =
  "px-2.5 pt-2 pb-1 text-caption1 font-medium text-text-tertiary";

// The one mounted top search, for ⌘G.
let searchInput: HTMLInputElement | null = null;

/** ⌘G: put the cursor in the top bar search. */
export function focusTopSearch() {
  searchInput?.focus();
  searchInput?.select();
}

type JoinedRoom = RoomResult & { lastActive: number };

/** Joined rooms and DMs as search options. */
function useJoinedRoomResults(): JoinedRoom[] {
  const rooms = useRoomList();
  const directRooms = useDirectRooms();
  return React.useMemo(() => {
    const dmIds = new Set(directRooms.map((r) => r.roomId));
    return rooms
      .filter((r) => !r.isSpaceRoom() && r.getMyMembership() === "join")
      .map((r) => {
        const isDm = dmIds.has(r.roomId);
        return {
          roomId: r.roomId,
          name: r.name || r.roomId,
          isDm,
          dmUserId: isDm ? r.guessDMUserId() : null,
          isPrivate: r.getJoinRule() === "invite",
          joined: true,
          lastActive: r.getLastActiveTimestamp(),
        };
      });
  }, [rooms, directRooms]);
}

const roomLabel = (room: RoomResult) =>
  room.isDm ? room.name : `#${room.name}`;

/**
 * Search field in the top bar. Focus opens results underneath: recent rooms
 * while empty, then matching rooms and messages. In a room, the first option
 * narrows the search to it.
 */
export function TopSearch({
  workforceSpaceId = null,
}: {
  workforceSpaceId?: string | null;
}) {
  const navigate = useNavigate();
  const currentRoomId = useMatch("/room/:roomId")?.params.roomId ?? null;
  const rooms = useJoinedRoomResults();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [scopeRoomId, setScopeRoomId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const keyDownRef =
    React.useRef<React.KeyboardEventHandler<HTMLInputElement> | null>(null);

  React.useEffect(() => {
    searchInput = inputRef.current;
    return () => {
      searchInput = null;
    };
  }, []);

  const scopeRoom = rooms.find((r) => r.roomId === scopeRoomId) ?? null;
  const currentRoom = rooms.find((r) => r.roomId === currentRoomId) ?? null;

  const close = () => {
    setOpen(false);
    setQuery("");
    setScopeRoomId(null);
    inputRef.current?.blur();
  };

  const openResult = (result: SearchResult) => {
    if (result.kind === "room") navigate(`/room/${result.room.roomId}`);
    else if (result.kind === "message") navigate(messageHitPath(result.hit));
    else {
      const q = scopeRoomId
        ? `in:${scopeRoomId} ${query.trim()}`
        : query.trim();
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
    close();
  };

  const scope = (roomId: string | null) => {
    setScopeRoomId(roomId);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          className="mx-auto flex h-7 w-full max-w-md min-w-0 items-center gap-2 rounded-utility border border-sidebar-border bg-background px-2.5 text-body2 transition-colors focus-within:border-surface-border-secondary hover:border-surface-border-secondary"
        >
          <SearchIcon
            className="size-4 shrink-0 text-text-tertiary"
            aria-hidden
          />
          {scopeRoom ? (
            <SearchScopeChip
              label={roomLabel(scopeRoom)}
              onRemove={() => scope(null)}
            />
          ) : null}
          <input
            ref={inputRef}
            aria-label={
              scopeRoom ? `Search in ${roomLabel(scopeRoom)}` : "Search"
            }
            autoCapitalize="none"
            autoCorrect="off"
            className="h-full min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-tertiary"
            data-testid="top-search-input"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => keyDownRef.current?.(event)}
            placeholder={scopeRoom ? "Search messages" : "Search"}
            role="combobox"
            aria-expanded={open}
            spellCheck={false}
            value={query}
          />
          {!open && !query ? (
            <span className="hidden items-center gap-0.5 sm:flex" aria-hidden>
              {getPlatformKeysById("search")?.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden p-0"
        data-testid="top-search-results"
        // Focus stays in the search field while the results are open.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node))
            event.preventDefault();
        }}
      >
        <TopSearchResults
          keyDownRef={keyDownRef}
          query={query}
          rooms={rooms}
          scopeRoom={scopeRoom}
          currentRoom={scopeRoom ? null : currentRoom}
          workforceSpaceId={workforceSpaceId}
          onScope={() => currentRoom && scope(currentRoom.roomId)}
          onRemoveScope={() => scope(null)}
          onOpen={openResult}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted only while the results are open, so nothing is fetched for a closed search. */
function TopSearchResults({
  keyDownRef,
  query,
  rooms,
  scopeRoom,
  currentRoom,
  workforceSpaceId,
  onScope,
  onRemoveScope,
  onOpen,
}: {
  keyDownRef: React.RefObject<React.KeyboardEventHandler<HTMLInputElement> | null>;
  query: string;
  rooms: JoinedRoom[];
  scopeRoom: RoomResult | null;
  currentRoom: RoomResult | null;
  workforceSpaceId: string | null;
  onScope: () => void;
  onRemoveScope: () => void;
  onOpen: (result: SearchResult) => void;
}) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const trimmed = query.trim();
  const parsed = parseSearchOperators(trimmed);
  const searchesRooms =
    !scopeRoom && !parsed.in && !parsed.from && parsed.text !== "";
  const publicRooms = usePublicRooms(searchesRooms ? parsed.text : "");
  const messages = useMessageSearch(trimmed, {
    roomId: scopeRoom?.roomId ?? null,
    workforceSpaceId,
    limit: MAX_MESSAGES,
  });

  const roomResults = React.useMemo<SearchResult[]>(() => {
    if (!trimmed) {
      if (scopeRoom) return [];
      return [...rooms]
        .sort((a, b) => b.lastActive - a.lastActive)
        .slice(0, MAX_SUGGESTIONS)
        .map((room) => ({ kind: "room", room }));
    }
    if (!searchesRooms) return [];
    const term = parsed.text.toLowerCase();
    const joined = rooms.filter((r) => r.name.toLowerCase().includes(term));
    const joinedIds = new Set(rooms.map((r) => r.roomId));
    const unjoined: RoomResult[] = publicRooms.rooms
      .filter((r) => !r.isSpace && !joinedIds.has(r.roomId))
      .map((r) => ({
        roomId: r.roomId,
        name: r.name ?? r.roomId,
        topic: r.topic,
        isDm: false,
        joined: false,
      }));
    return [...joined, ...unjoined]
      .slice(0, MAX_ROOMS)
      .map((room) => ({ kind: "room", room }));
  }, [
    trimmed,
    scopeRoom,
    rooms,
    searchesRooms,
    parsed.text,
    publicRooms.rooms,
  ]);

  const messageResults: SearchResult[] = messages.hits.map((hit) => ({
    kind: "message",
    hit,
  }));
  const actionResults: SearchResult[] = trimmed
    ? [{ kind: "action", id: "see-all", title: "See all results" }]
    : [];
  const hasLeadingAction = currentRoom !== null;
  const options = [...roomResults, ...messageResults, ...actionResults];
  const offset = hasLeadingAction ? 1 : 0;

  keyDownRef.current = useSearchKeyboardNav({
    count: options.length + offset,
    onOpen: (index) => {
      if (hasLeadingAction && index === 0) onScope();
      else if (options[index - offset]) onOpen(options[index - offset]!);
    },
    onRemoveScope,
    query,
    scopeActive: scopeRoom !== null,
    selectedIndex,
    setSelectedIndex,
  });

  const row = (result: SearchResult, at: number) => (
    <SearchResultRow
      key={resultKey(result)}
      result={result}
      query={messages.term}
      index={at + offset}
      isSelected={selectedIndex === at + offset}
      onSelect={() => onOpen(result)}
      onMouseEnter={() => setSelectedIndex(at + offset)}
    />
  );

  return (
    <div
      className="max-h-[min(60vh,32rem)] overflow-y-auto"
      role="listbox"
      aria-label="Search results"
    >
      {currentRoom ? (
        <CurrentRoomSearchAction
          roomLabel={roomLabel(currentRoom)}
          isDm={currentRoom.isDm}
          isSelected={selectedIndex === 0}
          onActivate={onScope}
          onMouseEnter={() => setSelectedIndex(0)}
        />
      ) : null}
      <div className="p-1.5">
        {roomResults.length > 0 ? (
          <div data-search-section="rooms">
            <div className={SECTION_TITLE_CLASS}>
              {trimmed ? "Rooms" : "Recent"}
            </div>
            {roomResults.map((r, i) => row(r, i))}
          </div>
        ) : null}
        {trimmed && parsed.text ? (
          <div data-search-section="messages">
            <div className={SECTION_TITLE_CLASS}>Messages</div>
            {messageResults.length > 0 ? (
              messageResults.map((r, i) => row(r, roomResults.length + i))
            ) : (
              <MessageSearchStatus
                status={messages.status}
                error={messages.error}
                term={parsed.text}
              />
            )}
          </div>
        ) : null}
        {!trimmed && roomResults.length === 0 ? (
          <p className="px-2.5 py-2 text-body2 text-text-tertiary">
            {scopeRoom
              ? `Type to search ${roomLabel(scopeRoom)}.`
              : "Type to search rooms and messages."}
          </p>
        ) : null}
        {actionResults.map((r, i) => (
          <div
            className="mt-1 border-t border-surface-border-primary pt-1"
            key={resultKey(r)}
          >
            {row(r, roomResults.length + messageResults.length + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
