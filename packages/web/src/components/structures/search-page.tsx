import { useState } from "react";
import { Navigate, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { MessageSearchStatus, SearchResultRow } from "@/components/search/search-result-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { MatrixClientPeg } from "../../client/peg";
import { clientExt } from "../../client/client-ext";
import { useGlobalSearchEnabled } from "../../client/feature-flags";
import { type PublicRoom, usePublicRooms } from "../../hooks/use-public-rooms";
import { useJoinRoom } from "../../hooks/use-join-room";
import { messageHitPath, useMessageSearch } from "../../hooks/use-message-search";
import { parseSearchOperators } from "../../lib/search/parse-search-operators";
import type { Scope } from "./sidebar/scope";
import type { LoggedInOutletContext } from "./logged-in-view";
import { SpaceChildRow } from "./space-child-row";

type TabValue = "messages" | "rooms";

/**
 * Route wrapper: takes the workforce space from the logged-in Outlet context.
 * /search is global_search-gated — off the flag it bounces back to the Lobby.
 */
export function SearchPageRoute() {
  const { spaceId, setScope } = useOutletContext<LoggedInOutletContext>();
  if (!useGlobalSearchEnabled()) return <Navigate to="/" replace />;
  return <SearchPage spaceId={spaceId} setScope={setScope} />;
}

/** Full search results: messages (`?q=`, with `in:` / `from:`) and the public room directory. */
export function SearchPage({
  spaceId,
  setScope,
}: {
  /** The workforce space: whose roster marks agents among message authors. */
  spaceId: string | null;
  setScope?: (scope: Scope) => void;
}) {
  const [params, setParams] = useSearchParams();
  const term = params.get("q") ?? "";
  const [tab, setTab] = useState<TabValue>("messages");

  const tabs: { value: TabValue; label: string }[] = [
    { value: "messages", label: "Messages" },
    { value: "rooms", label: "All rooms" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="font-heading text-subtitle font-medium">Search</h1>
        <Input
          autoFocus
          aria-label="search"
          value={term}
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
          placeholder="Search messages and rooms… (in:#room, from:@user)"
          className="mt-2"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} tabs={tabs}>
          {tab === "messages" ? (
            <MessagesTab term={term} spaceId={spaceId} />
          ) : (
            <AllRoomsTab term={parseSearchOperators(term).text} setScope={setScope} />
          )}
        </Tabs>
      </div>
    </div>
  );
}

function MessagesTab({ term, spaceId }: { term: string; spaceId: string | null }) {
  const navigate = useNavigate();
  const { status, hits, error, term: matched } = useMessageSearch(term, { workforceSpaceId: spaceId, limit: 50 });
  if (!parseSearchOperators(term).text) {
    return <p className="text-body2 text-muted-foreground">Type to search messages.</p>;
  }
  if (hits.length === 0) return <MessageSearchStatus status={status} error={error} term={matched} className="px-0" />;
  return (
    <div role="listbox" aria-label="Messages" className="flex flex-col">
      {hits.map((hit, i) => (
        <SearchResultRow
          key={hit.id}
          result={{ kind: "message", hit }}
          query={matched}
          index={i}
          isSelected={false}
          onSelect={() => navigate(messageHitPath(hit))}
        />
      ))}
    </div>
  );
}

function AllRoomsTab({ term, setScope }: { term: string; setScope?: (scope: Scope) => void }) {
  const { rooms, loading, error, hasMore, loadMore } = usePublicRooms(term);
  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-caption1 text-destructive">{error}</p>}
      {loading && rooms.length === 0 ? (
        <p className="text-body2 text-muted-foreground">Searching…</p>
      ) : rooms.length === 0 ? (
        <p className="text-body2 text-muted-foreground">No public rooms found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rooms.map((r: PublicRoom) => (
            <PublicRoomRow key={r.roomId} room={r} setScope={setScope} />
          ))}
        </ul>
      )}
      {hasMore && (
        <Button size="sm" variant="outline" onClick={() => loadMore()}>
          Load more
        </Button>
      )}
    </div>
  );
}

function PublicRoomRow({
  room,
  setScope,
}: {
  room: PublicRoom;
  setScope?: (scope: Scope) => void;
}) {
  const { joinRoom, joining } = useJoinRoom();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const onActivate = async () => {
    if (room.isSpace) {
      const client = MatrixClientPeg.safeGet();
      if (!client) return;
      setBusy(true);
      try {
        await clientExt(client).joinRoom(room.roomId);
        setScope?.({ kind: "space", spaceId: room.roomId });
        navigate("/");
      } finally {
        setBusy(false);
      }
      return;
    }
    await joinRoom(room.roomId);
  };

  return (
    <SpaceChildRow
      name={room.name ?? room.roomId}
      topic={room.topic}
      memberCount={room.memberCount}
      kind={room.isSpace ? "space" : "room"}
      spaceLabel="Workspace"
      joined={false}
      busy={joining || busy}
      onActivate={() => void onActivate()}
    />
  );
}
