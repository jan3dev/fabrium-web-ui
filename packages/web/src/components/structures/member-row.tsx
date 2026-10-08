// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/channels/ui/MembersSidebarMemberCard.tsx. Modified.
import { type ReactNode, useState } from "react";

import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import {
  BanIcon,
  CloseIcon,
  DoorOpenIcon,
  EllipsisIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { UserProfilePopover } from "@/components/user-profile-popover";
import { cn } from "@/lib/utils";
import { MatrixClientPeg } from "../../client/peg";
import type { MemberRole } from "../../hooks/use-member-roles";
import { useMyPowerLevel } from "../../hooks/use-my-power-level";
import { usePresence } from "../../hooks/use-presence";
import { useSetPowerLevel } from "../../hooks/use-set-power-level";
import { useActor } from "../../hooks/use-actor";
import { CREATOR_LEVEL, roleForLevel, roleLabel, standardRoleOptions } from "../../lib/roles";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";

/**
 * One member in the members pane: avatar with presence, name, an Agent chip
 * and Working/Idle for agents or the role for people, and the role and
 * moderation menu. The whole row opens the profile popover.
 */
export function MemberRow({
  roomId,
  userId,
  member,
  membership = "join",
  agent = false,
  working = false,
}: {
  roomId: string;
  userId: string;
  /**
   * The member's resolved role/power level, supplied by the parent so the row
   * doesn't re-derive the whole room. Undefined for pending invites (not yet
   * joined) and for callers that render a row without role context.
   */
  member?: MemberRole;
  membership?: "join" | "invite";
  agent?: boolean;
  /** The agent has an open turn in this room. */
  working?: boolean;
}) {
  const { presence } = usePresence(userId);
  const name = useActor(userId, roomId).displayName;
  const myPL = useMyPowerLevel(roomId);
  const me = MatrixClientPeg.safeGet()?.getUserId();

  const identity = (
    <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2.5">
      <UserAvatar userId={userId} size="sm" presence={presence} agent={agent} />
      <span className="truncate text-body2 font-medium">{name}</span>
      {agent ? (
        <Badge tone="agent" className="px-1.5 py-0 text-caption2">
          Agent
        </Badge>
      ) : null}
    </div>
  );

  const shell = (children: ReactNode) => (
    <div
      className="group/member relative isolate flex h-full w-full items-center gap-2 rounded-utility px-2 transition-colors hover:bg-surface-secondary focus-within:bg-surface-secondary"
      data-testid={`member-${userId}`}
    >
      <UserProfilePopover userId={userId} roomId={roomId}>
        <button
          type="button"
          aria-label={`Open profile for ${name}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-utility focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </UserProfilePopover>
      {identity}
      {children}
    </div>
  );

  if (membership === "invite") {
    const onCancel = async () => {
      try {
        await MatrixClientPeg.safeGet()?.kick(roomId, userId);
      } catch {
        // Server rejection: the pending list reflects the unchanged state.
      }
    };
    return shell(
      myPL.canKick ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Cancel invite"
          className="relative z-20 text-text-secondary hover:text-text-primary"
          onClick={() => void onCancel()}
        >
          <CloseIcon />
        </Button>
      ) : null,
    );
  }

  const role = member?.role ?? roleForLevel(0);
  const isSelf = userId === me;

  const canEditRoles = myPL.canSendStateEvent("m.room.power_levels");
  // Rule 9: editable only if viewer outranks the target (peers/superiors locked).
  // Self is editable (self-demote) regardless of own level.
  const targetLevel = member?.powerLevel ?? 0;
  // A room creator's level is fixed (room v12), even for themselves.
  const editable =
    canEditRoles && targetLevel !== CREATOR_LEVEL && (isSelf ? true : targetLevel < myPL.level);
  const canModerate = !isSelf && (myPL.canKick || myPL.canBan);

  return shell(
    <>
      {agent ? (
        <AgentStatusBadge working={working} className="relative z-10" />
      ) : (
        <span className="pointer-events-none relative z-10 text-caption1 text-text-tertiary">
          {roleLabel(role)}
        </span>
      )}
      {(editable || canModerate) && (
        <MemberActions
          roomId={roomId}
          userId={userId}
          currentLevel={role.level}
          viewerLevel={myPL.level}
          editable={editable}
          canKick={canModerate && myPL.canKick}
          canBan={canModerate && myPL.canBan}
          isCustomRole={role.kind === "custom"}
          customRoleLabel={roleLabel(role)}
        />
      )}
    </>,
  );
}

function MemberActions({
  roomId,
  userId,
  currentLevel,
  viewerLevel,
  editable,
  canKick,
  canBan,
  isCustomRole,
  customRoleLabel,
}: {
  roomId: string;
  userId: string;
  currentLevel: number;
  viewerLevel: number;
  editable: boolean;
  canKick: boolean;
  canBan: boolean;
  isCustomRole: boolean;
  customRoleLabel: string;
}) {
  const { setLevel, resetToDefault } = useSetPowerLevel(roomId);
  const [dialog, setDialog] = useState<"kick" | "ban" | null>(null);
  const options = standardRoleOptions(viewerLevel);

  const onSelectRole = async (value: string) => {
    try {
      if (value === "0") await resetToDefault(userId);
      else await setLevel(userId, Number(value));
    } catch {
      // Server/Rule-9 rejection: state hook reflects the unchanged level.
    }
  };

  const onConfirm = async (reason: string) => {
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    try {
      if (dialog === "kick")
        await client.kick(roomId, userId, reason || undefined);
      else if (dialog === "ban")
        await client.ban(roomId, userId, reason || undefined);
    } catch {
      // Server rejection: membership list reflects the unchanged state.
    }
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Member actions"
            className={cn(
              "relative z-20 text-text-secondary hover:text-text-primary",
              "opacity-0 group-hover/member:opacity-100 group-focus-within/member:opacity-100 data-[state=open]:opacity-100",
            )}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {editable && (
            <>
              <DropdownMenuLabel>Role</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(currentLevel)}
                onValueChange={onSelectRole}
              >
                {options.map((o) => (
                  <DropdownMenuRadioItem
                    key={o.kind}
                    value={String(o.level)}
                    disabled={o.disabled}
                  >
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
                {isCustomRole && (
                  // Show the current custom level as a selected, non-standard
                  // option so we never force it onto the ladder.
                  <DropdownMenuRadioItem value={String(currentLevel)} disabled>
                    {customRoleLabel}
                  </DropdownMenuRadioItem>
                )}
              </DropdownMenuRadioGroup>
            </>
          )}
          {editable && (canKick || canBan) && <DropdownMenuSeparator />}
          {canKick && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("kick")}
            >
              <DoorOpenIcon />
              Kick
            </DropdownMenuItem>
          )}
          {canBan && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDialog("ban")}
            >
              <BanIcon />
              Ban
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ModerationDialog
        kind={dialog ?? "kick"}
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={onConfirm}
      />
    </>
  );
}

function ModerationDialog({
  kind,
  open,
  onOpenChange,
  onConfirm,
}: {
  kind: "kick" | "ban";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const label = kind === "kick" ? "Kick" : "Ban";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === "kick" ? "Remove member" : "Ban member"}
          </DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(reason);
              setReason("");
              onOpenChange(false);
            }}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
