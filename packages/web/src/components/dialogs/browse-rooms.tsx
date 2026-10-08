// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/channels/ui/ChannelBrowserDialog.tsx. Modified.
import { useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";

import { CompassIcon, SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useJoinRoom } from "../../hooks/use-join-room";
import {
  type SpaceChild,
  useSpaceHierarchy,
} from "../../hooks/use-space-hierarchy";

type BrowseTab = "all" | "joined";

/**
 * The join flow the Lobby and the Browse rooms dialog share: a workspace's
 * rooms and projects from the hierarchy, a filter over name and topic, and
 * open-or-join on activate. Joining navigates to the room (useJoinRoom).
 */
export function useRoomBrowser(spaceId: string, enabled: boolean) {
  const navigate = useNavigate();
  const { children, loading } = useSpaceHierarchy(spaceId, enabled);
  const { joinRoom, error } = useJoinRoom();
  const [term, setTerm] = useState("");
  const [joinedOnly, setJoinedOnly] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const q = term.trim().toLowerCase();
  const matches = (c: SpaceChild) =>
    !q ||
    (c.name ?? c.roomId).toLowerCase().includes(q) ||
    (c.topic ?? "").toLowerCase().includes(q);

  /** Opens a joined room; joins any other. Resolves to whether the room is now open. */
  const activate = async (child: SpaceChild): Promise<boolean> => {
    if (child.joined) {
      navigate(`/room/${child.roomId}`);
      return true;
    }
    setJoiningId(child.roomId);
    try {
      return (await joinRoom(child.roomId)) !== null;
    } finally {
      setJoiningId(null);
    }
  };

  return {
    term,
    setTerm,
    query: q,
    joinedOnly,
    setJoinedOnly,
    loading,
    error,
    joiningId,
    rooms: children.filter(
      (c) => c.kind === "room" && matches(c) && (!joinedOnly || c.joined),
    ),
    projects: children.filter((c) => c.kind === "space" && matches(c)),
    activate,
  };
}

function BrowseState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-card bg-accent-brand-transparent text-accent-brand">
        <Icon className="size-4" />
      </div>
      <p className="mt-4 font-heading text-body1 font-semibold">{title}</p>
      <p className="mt-2 max-w-md text-body2 text-text-secondary">
        {description}
      </p>
    </div>
  );
}

export function BrowseRoomsDialog({
  open,
  spaceId,
  onOpenChange,
}: {
  open: boolean;
  spaceId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const browser = useRoomBrowser(spaceId, open);
  const { rooms, query } = browser;

  const select = async (room: SpaceChild) => {
    if (await browser.activate(room)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 sm:max-w-xl"
        data-testid="browse-rooms-dialog"
      >
        <DialogHeader className="pb-5">
          <DialogTitle>Browse rooms</DialogTitle>
          <label
            className="mt-3 flex h-11 cursor-text items-center gap-3 rounded-utility border border-surface-border-secondary bg-surface-secondary px-3 transition-colors focus-within:border-ring"
            htmlFor="browse-rooms-search"
          >
            <SearchIcon className="size-4 shrink-0 text-text-tertiary" />
            <input
              id="browse-rooms-search"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-body2 text-text-primary outline-none placeholder:text-text-tertiary"
              placeholder="Search rooms by name or topic"
              value={browser.term}
              onChange={(e) => browser.setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  rooms[0]
                ) {
                  e.preventDefault();
                  void select(rooms[0]);
                }
              }}
            />
          </label>
        </DialogHeader>
        <Tabs
          value={browser.joinedOnly ? "joined" : "all"}
          onValueChange={(v) =>
            browser.setJoinedOnly((v as BrowseTab) === "joined")
          }
          tabs={[
            { value: "all", label: "All rooms" },
            { value: "joined", label: "Joined" },
          ]}
        >
          <div className="h-[min(60vh,30rem)] overflow-y-auto pb-2">
            {browser.error ? (
              <p className="mb-3 text-body2 text-accent-danger">
                {browser.error}
              </p>
            ) : null}
            {browser.loading && rooms.length === 0 ? (
              <div className="flex justify-center py-16">
                <Spinner size="medium" />
              </div>
            ) : rooms.length === 0 ? (
              <BrowseState
                icon={query ? SearchIcon : CompassIcon}
                title={query ? "No rooms match" : "No rooms yet"}
                description={
                  query
                    ? `Nothing matches “${browser.term.trim()}”. Try another name or topic.`
                    : "Rooms created in this workspace show up here."
                }
              />
            ) : (
              <ul className="divide-y divide-surface-border-primary overflow-hidden rounded-card border border-surface-border-primary">
                {rooms.map((room) => (
                  <RoomCard
                    key={room.roomId}
                    room={room}
                    joining={browser.joiningId === room.roomId}
                    onSelect={() => void select(room)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function RoomCard({
  room,
  joining,
  onSelect,
}: {
  room: SpaceChild;
  joining: boolean;
  onSelect: () => void;
}) {
  const name = room.name ?? room.roomId;
  const members = `${room.memberCount} ${room.memberCount === 1 ? "member" : "members"}`;
  return (
    <li
      aria-label={name}
      className="group/room-row flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-secondary"
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-body2 text-text-tertiary">#</span>
          <span className="min-w-0 truncate text-body1 font-medium">
            {name}
          </span>
          {room.joined ? (
            <span className="shrink-0 text-caption1 text-text-tertiary">
              Joined
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-body2 text-text-secondary">
          {members}
          {room.topic ? (
            <>
              <span className="px-1.5">·</span>
              <span title={room.topic}>{room.topic}</span>
            </>
          ) : null}
        </span>
      </button>
      {room.joined ? null : (
        <Button
          type="button"
          size="sm"
          disabled={joining}
          onClick={onSelect}
          className={
            joining
              ? "shrink-0"
              : "shrink-0 opacity-0 transition-opacity group-focus-within/room-row:opacity-100 group-hover/room-row:opacity-100 max-md:opacity-100"
          }
        >
          {joining ? "Joining…" : "Join"}
        </Button>
      )}
    </li>
  );
}
