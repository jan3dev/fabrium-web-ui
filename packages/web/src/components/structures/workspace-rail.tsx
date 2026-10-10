// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/CommunityRail.tsx. Modified.
import { type Room } from "matrix-js-sdk";
import type * as React from "react";
import { useMemo } from "react";

import { CircleCheckIcon, HomeIcon } from "@/components/icons";
import { useRoomAvatarMxc } from "@/components/room-avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthedMediaUrl } from "@/lib/matrix/authed-media";
import { cn } from "@/lib/utils";
import { MatrixClientPeg } from "../../client/peg";
import { useJoinedSpaces } from "../../hooks/use-joined-spaces";
import { markAllRead } from "../../hooks/use-mark-read";
import { useSpaceUnread } from "../../hooks/use-space-unread";
import type { UnreadCounts } from "../../hooks/use-unread";
import { initials } from "../../lib/sender";
import type { Scope } from "./sidebar/scope";

const MAX_BADGE = 99;

/**
 * Two-tier indicator: a mention count when the workspace has mentions, else a
 * plain dot for ordinary unread. Never both.
 */
export function railIndicators({ total, highlight }: UnreadCounts) {
  const showBadge = highlight > 0;
  return {
    showBadge,
    showDot: total > 0 && !showBadge,
    badgeLabel: highlight > MAX_BADGE ? `${MAX_BADGE}+` : String(highlight),
  };
}

function childRoomIds(space: Room): string[] {
  return space.currentState
    .getStateEvents("m.space.child")
    .filter((ev) => Array.isArray((ev.getContent() as { via?: unknown }).via))
    .map((ev) => ev.getStateKey())
    .filter((id): id is string => !!id);
}

/** Workspaces = joined spaces that no other joined space lists as a child (those are projects). */
function useWorkspaces(): Room[] {
  const spaces = useJoinedSpaces();
  return useMemo(() => {
    const nested = new Set(spaces.flatMap(childRoomIds));
    return spaces.filter((s) => !nested.has(s.roomId));
  }, [spaces]);
}

function RailButton({
  label,
  isActive,
  onSelect,
  unread,
  children,
}: {
  label: string;
  isActive: boolean;
  onSelect: () => void;
  unread?: UnreadCounts;
  children: React.ReactNode;
}) {
  const { showBadge, showDot, badgeLabel } = railIndicators(
    unread ?? { total: 0, highlight: 0 },
  );
  const accessibleLabel = showBadge
    ? `${label}, ${unread!.highlight} mention${unread!.highlight === 1 ? "" : "s"}`
    : showDot
      ? `${label}, unread`
      : label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-current={isActive ? "true" : undefined}
          aria-label={accessibleLabel}
          className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center outline-hidden"
          onClick={onSelect}
        >
          {isActive ? (
            <span
              aria-hidden
              className="absolute -left-2.5 h-5 w-1 rounded-r-full bg-accent-brand"
            />
          ) : null}
          <span
            className={cn(
              "flex size-9 items-center justify-center overflow-hidden rounded-card bg-sidebar-accent text-caption1 font-semibold text-sidebar-foreground/80 outline-2 outline-offset-2 outline-transparent transition-[outline-color] [&>svg]:size-4",
              isActive
                ? "outline-accent-brand"
                : "hover:outline-accent-brand/50",
            )}
          >
            {children}
          </span>
          {showBadge ? (
            <span className="absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-button-primary-background px-1 text-caption2 font-semibold text-button-primary-foreground ring-2 ring-sidebar">
              {badgeLabel}
            </span>
          ) : showDot ? (
            <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-accent-brand ring-2 ring-sidebar" />
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {accessibleLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function WorkspaceButton({
  space,
  isActive,
  onSelect,
}: {
  space: Room;
  isActive: boolean;
  onSelect: () => void;
}) {
  const unread = useSpaceUnread(space.roomId);
  const iconUrl = useAuthedMediaUrl(useRoomAvatarMxc(space.roomId), {
    width: 64,
    height: 64,
    method: "crop",
  });
  const name = space.name || space.roomId;

  const markWorkspaceRead = () => {
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    markAllRead(childRoomIds(space).flatMap((id) => client.getRoom(id) ?? []));
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div>
          <RailButton
            label={name}
            isActive={isActive}
            onSelect={onSelect}
            unread={unread}
          >
            {iconUrl ? (
              <img
                alt=""
                className="size-full object-cover"
                draggable={false}
                src={iconUrl}
              />
            ) : (
              initials(name)
            )}
          </RailButton>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={markWorkspaceRead}>
          <CircleCheckIcon />
          Mark all as read
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Vertical rail of workspaces on the far left: Home (every room) plus one
 * button per top-level space. Shows a mention badge or unread dot per
 * workspace; right-click marks a workspace read.
 */
export function WorkspaceRail({
  scope,
  onSelect,
  className,
}: {
  scope: Scope;
  onSelect: (scope: Scope) => void;
  className?: string;
}) {
  const workspaces = useWorkspaces();

  return (
    <nav
      aria-label="Workspaces"
      className={cn(
        "scrollbar-custom flex w-14 shrink-0 flex-col items-center gap-2.5 overflow-y-auto bg-sidebar px-2.5 py-2",
        className,
      )}
    >
      <RailButton
        label="Home"
        isActive={scope.kind === "home"}
        onSelect={() => onSelect({ kind: "home" })}
      >
        <HomeIcon aria-hidden />
      </RailButton>
      {workspaces.length > 0 ? (
        <span aria-hidden className="h-px w-6 shrink-0 bg-sidebar-border" />
      ) : null}
      {workspaces.map((space) => (
        <WorkspaceButton
          key={space.roomId}
          space={space}
          isActive={scope.kind === "space" && scope.spaceId === space.roomId}
          onSelect={() => onSelect({ kind: "space", spaceId: space.roomId })}
        />
      ))}
    </nav>
  );
}
