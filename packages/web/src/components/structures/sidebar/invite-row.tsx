import { Button } from "@/components/ui/button";
import { MatrixClientPeg } from "../../../client/peg";
import type { PendingInvite } from "../../../hooks/use-pending-invites";

export function InviteRow({ invite }: { invite: PendingInvite }) {
  const accept = () => void MatrixClientPeg.safeGet()?.joinRoom(invite.roomId);
  const decline = () => void MatrixClientPeg.safeGet()?.leave(invite.roomId);

  const displayName = invite.name || invite.roomId;
  const inviterLabel = invite.inviter
    ? invite.inviter.replace(/^@/, "").split(":")[0]
    : "someone";

  return (
    <li className="flex flex-col gap-1 rounded-utility px-2 py-1.5 hover:bg-sidebar-accent">
      <span className="truncate text-body2 font-medium">{displayName}</span>
      <span className="truncate text-caption1 text-muted-foreground">Invited by {inviterLabel}</span>
      <div className="flex gap-1">
        <Button size="xs" onClick={accept}>
          Accept
        </Button>
        <Button size="xs" variant="outline" onClick={decline}>
          Decline
        </Button>
      </div>
    </li>
  );
}
