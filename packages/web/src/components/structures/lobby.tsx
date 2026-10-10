import { useNavigate, useOutletContext } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MatrixClientPeg } from "../../client/peg";
import { useRoomTopic } from "../../hooks/use-room-topic";
import type { SpaceChild } from "../../hooks/use-space-hierarchy";
import { useRoomBrowser } from "../dialogs/browse-rooms";
import { useSpaceName } from "../../hooks/use-space-name";
import { TopicText } from "../timeline/topic-text";
import { EmptyRoom } from "./empty-room";
import type { LoggedInOutletContext } from "./logged-in-view";
import type { Scope } from "./sidebar/scope";
import { SpaceChildRow } from "./space-child-row";

/**
 * Route wrapper: resolves the active space from the logged-in Outlet context.
 * Reads `activeScope`, not the context's separate `spaceId` — that field is
 * only the workforce-space lookup (runtime `workforce_space`), which is null
 * whenever that alias doesn't resolve, even though `activeScope` may already
 * be sitting on a space via the ZNC008 single-joined-space fallback. Using
 * the raw field here stranded the Lobby on "Pick a room" while the sidebar,
 * which already reads `activeScope`, showed that space's rooms correctly.
 */
export function LobbyRoute() {
  const { activeScope, setScope } = useOutletContext<LoggedInOutletContext>();
  if (activeScope.kind !== "space") return <EmptyRoom />;
  return <Lobby spaceId={activeScope.spaceId} setScope={setScope} />;
}

export function Lobby({
  spaceId,
  setScope,
}: {
  spaceId: string;
  setScope: (scope: Scope) => void;
}) {
  const navigate = useNavigate();
  const name = useSpaceName(spaceId) ?? MatrixClientPeg.safeGet()?.getRoom(spaceId)?.name ?? spaceId;
  const topic = useRoomTopic(spaceId);
  const memberCount = MatrixClientPeg.safeGet()?.getRoom(spaceId)?.getJoinedMemberCount() ?? 0;
  const { term, setTerm, query: q, joinedOnly, setJoinedOnly, rooms, projects: spaces, activate, joiningId } =
    useRoomBrowser(spaceId, true);

  const activateSpace = (child: SpaceChild) => {
    setScope({ kind: "space", spaceId: child.roomId });
    navigate("/");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="border-b border-border px-6 py-6">
        <h1 className="font-heading text-h3 font-semibold text-text-primary">{name}</h1>
        {topic && (
          <div className="mt-2 text-body2 text-text-secondary">
            <TopicText topic={topic} clamp={false} />
          </div>
        )}
        <p className="mt-2 text-caption1 text-text-secondary">
          {memberCount} member{memberCount !== 1 ? "s" : ""}
        </p>
      </header>
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <Input
          type="search"
          aria-label="Filter rooms"
          placeholder="Filter…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="flex-1"
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant={joinedOnly ? "ghost" : "secondary"}
            aria-pressed={!joinedOnly}
            onClick={() => setJoinedOnly(false)}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={joinedOnly ? "secondary" : "ghost"}
            aria-pressed={joinedOnly}
            onClick={() => setJoinedOnly(true)}
          >
            Joined
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-6 p-6">
        {rooms.length === 0 && spaces.length === 0 && (
          <p className="text-body2 text-text-secondary">
            {q ? `No rooms or projects match “${term.trim()}”.` : "Nothing here yet."}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {rooms.map((r) => (
            <SpaceChildRow
              key={r.roomId}
              name={r.name ?? r.roomId}
              topic={r.topic}
              memberCount={r.memberCount}
              kind="room"
              joined={r.joined}
              busy={joiningId === r.roomId}
              onActivate={() => void activate(r)}
            />
          ))}
        </ul>
        {spaces.length > 0 && (
          <section role="region" aria-label="Projects" className="flex flex-col gap-2">
            <h2 className="text-caption1 font-semibold text-text-secondary">Projects</h2>
            <ul className="flex flex-col gap-2">
              {spaces.map((s) => (
                <SpaceChildRow
                  key={s.roomId}
                  name={s.name ?? s.roomId}
                  topic={s.topic}
                  memberCount={s.memberCount}
                  kind="space"
                  joined={s.joined}
                  onActivate={() => activateSpace(s)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
