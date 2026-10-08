import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

import { CommentIcon } from "@/components/icons";
import { PresenceBadge, toPresenceStatus } from "@/components/presence-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { MatrixClientPeg } from "@/client/peg";
import { usePresence } from "@/hooks/use-presence";
import { useActor } from "@/hooks/use-actor";
import { type KnownAgent, useKnownAgent } from "@/hooks/use-workforce";
import { createDirectRoom, findDirectRoom } from "@/lib/matrix/direct-messages";
import type { ActorSummary } from "@/model/types";

const ACTOR_BADGE = { agent: "Agent", system: "System" } as const;

/** Opens a small profile card for `userId` from `children` (the trigger, e.g. an avatar or name). */
export function UserProfilePopover({
  userId,
  roomId,
  children,
}: {
  userId: string;
  /** Scopes the display name to this room's member state. */
  roomId?: string;
  children: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        data-testid="user-profile-popover"
      >
        {open ? (
          <ProfileCard
            userId={userId}
            roomId={roomId}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ProfileCard({
  userId,
  roomId,
  onDone,
}: {
  userId: string;
  roomId?: string;
  onDone: () => void;
}) {
  const known = useKnownAgent(userId);
  const actor = useActor(userId, roomId);
  const { presence } = usePresence(userId);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <UserAvatar userId={userId} size="lg" agent={actor.kind === "agent"} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-heading text-subtitle font-semibold">
              {actor.displayName}
            </span>
            {actor.kind === "human" ? null : (
              <Badge tone={actor.kind} className="px-1.5 py-0 text-caption2">
                {ACTOR_BADGE[actor.kind]}
              </Badge>
            )}
          </div>
          <span className="block truncate text-caption1 text-text-tertiary">
            {userId}
          </span>
        </div>
      </div>
      <PresenceBadge
        status={toPresenceStatus(presence)}
        className="self-start"
      />
      {known ? (
        <AgentFacts actor={actor} known={known} onNavigate={onDone} />
      ) : null}
      <MessageButton userId={userId} agent={!!known} onDone={onDone} />
    </div>
  );
}

function AgentFacts({
  actor,
  known,
  onNavigate,
}: {
  actor: ActorSummary;
  known: KnownAgent;
  onNavigate: () => void;
}) {
  const client = MatrixClientPeg.safeGet();
  // Only rooms the viewer has joined: other links would open an empty room.
  const rooms = known.agent.rooms
    .map((id) => client?.getRoom(id))
    .filter((r) => r?.getMyMembership() === "join");
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body2">
      <dt className="text-text-tertiary">Persona</dt>
      <dd className="truncate">{actor.persona}</dd>
      {actor.project ? (
        <>
          <dt className="text-text-tertiary">Project</dt>
          <dd className="truncate">{actor.project}</dd>
        </>
      ) : null}
      {rooms.length > 0 ? (
        <>
          <dt className="text-text-tertiary">Rooms</dt>
          <dd className="flex min-w-0 flex-col">
            {rooms.map((r) => (
              <Link
                key={r!.roomId}
                to={`/room/${r!.roomId}`}
                onClick={onNavigate}
                className="truncate text-accent-brand hover:underline"
              >
                {r!.name || r!.roomId}
              </Link>
            ))}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * Opens the DM with this person, creating it if there is none. Agents get no
 * new DM from here (they join rooms through zooid.yaml), only an existing one.
 */
function MessageButton({
  userId,
  agent,
  onDone,
}: {
  userId: string;
  agent: boolean;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const client = MatrixClientPeg.safeGet();
  if (!client || userId === client.getUserId()) return null;
  const existing = findDirectRoom(client, userId);
  if (!existing && agent) return null;

  const onClick = async () => {
    setBusy(true);
    try {
      const roomId = existing ?? (await createDirectRoom(client, [userId]));
      onDone();
      navigate(`/room/${roomId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={busy}
      onClick={() => void onClick()}
    >
      <CommentIcon />
      Message
    </Button>
  );
}
