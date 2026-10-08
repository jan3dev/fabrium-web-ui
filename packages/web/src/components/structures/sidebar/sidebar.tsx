import { CompassIcon, FlagIcon, InboxIcon, PlusIcon } from "@/components/icons";
import { type Room } from "matrix-js-sdk";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDirectRooms } from "../../../hooks/use-direct-rooms";
import { useFavoriteRooms } from "../../../hooks/use-favorite-rooms";
import { useInboxNeedsActionCount } from "../../../hooks/use-inbox";
import { useMyPowerLevel } from "../../../hooks/use-my-power-level";
import { useRoomList } from "../../../hooks/use-room-list";
import { useSectionUnread } from "../../../hooks/use-section-unread";
import { useSpaceChildren } from "../../../hooks/use-space-children";
import { useWorkforce } from "../../../hooks/use-workforce";
import { BrowseRoomsDialog } from "../../dialogs/browse-rooms";
import { CreateDmDialog } from "../../dialogs/create-dm";
import { CreateRoomDialog } from "../../dialogs/create-room";
import { InvitesSection } from "./invites-section";
import { MoreUnreadButton, useUnreadOverflow } from "./more-unread-button";
import { RoomRow } from "./room-row";
import type { Scope } from "./scope";
import { SECTION_ICON_BUTTON_CLASS, Section } from "./section";
import { UnreadBadge } from "./unread-badge";

interface SidebarProps {
  scope: Scope;
  workforceSpaceId: string | null;
}

/** A subspace's own joined room children, one collapsible Section, depth bounded at one level. */
function SubspaceSection({ room, isAgent }: { room: Room; isAgent: (userId: string) => boolean }) {
  const children = useSpaceChildren(room.roomId).filter((r) => !r.isSpaceRoom());
  const unread = useSectionUnread(children);
  return (
    <Section
      title={room.name || room.roomId}
      storageKey={`section:${room.roomId}`}
      action={<UnreadBadge total={unread.total} highlight={unread.highlight} />}
    >
      {children.map((r) => (
        <RoomRow key={r.roomId} room={r} isAgent={isAgent} />
      ))}
    </Section>
  );
}

export function Sidebar({ scope, workforceSpaceId }: SidebarProps) {
  const spaceId = scope.kind === "space" ? scope.spaceId : "";
  const { pathname } = useLocation();
  const favorites = useFavoriteRooms();
  const dms = useDirectRooms();
  const spaceChildren = useSpaceChildren(spaceId);
  const allRooms = useRoomList();
  const myPL = useMyPowerLevel(spaceId);
  const canCreateRoom = scope.kind === "space" && myPL.canSendStateEvent("m.space.child");
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [createDmOpen, setCreateDmOpen] = useState(false);
  const { isAgent } = useWorkforce(workforceSpaceId ?? "");
  const needsAction = useInboxNeedsActionCount(workforceSpaceId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { overflow, scrollTo } = useUnreadOverflow(scrollRef);

  // First-claim ordering: Favorites → DMs → Rooms.
  const claimed = new Set<string>();
  const claim = (rooms: Room[]) => {
    const out: Room[] = [];
    for (const r of rooms) {
      if (claimed.has(r.roomId)) continue;
      claimed.add(r.roomId);
      out.push(r);
    }
    return out;
  };
  const subspaces = spaceChildren.filter((r) => r.isSpaceRoom());
  // This is the bug fix — the space branch used to pass subspaces through as room rows.
  const roomSource =
    scope.kind === "space"
      ? spaceChildren.filter((r) => !r.isSpaceRoom())
      : allRooms.filter((r) => !r.isSpaceRoom());
  const favList = claim(favorites);
  const dmList = claim(dms);
  const roomList = claim(roomSource);

  const favUnread = useSectionUnread(favList);
  const dmUnread = useSectionUnread(dmList);
  const roomUnread = useSectionUnread(roomList);

  const dmIds = new Set(dms.map((r) => r.roomId));
  const row = (r: Room) => <RoomRow key={r.roomId} room={r} isDm={dmIds.has(r.roomId)} isAgent={isAgent} />;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {overflow.above.count > 0 ? (
        <MoreUnreadButton
          count={overflow.above.count}
          emphasis={overflow.above.highlight ? "primary" : "default"}
          onClick={() => scrollTo("top")}
          position="top"
        />
      ) : null}
      <SidebarContent ref={scrollRef} className="gap-0 overscroll-none pt-1">
        <SidebarMenu className="px-2 pb-1">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/inbox"}>
              <Link to="/inbox">
                <InboxIcon aria-hidden />
                <span className="flex-1">Inbox</span>
                <UnreadBadge total={needsAction} highlight={needsAction} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {scope.kind === "space" ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/"}>
                <Link to="/">
                  <FlagIcon aria-hidden />
                  <span>Lobby</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
        <InvitesSection />
        <Section
          title="Favorites"
          action={<UnreadBadge total={favUnread.total} highlight={favUnread.highlight} />}
        >
          {favList.map(row)}
        </Section>
        <Section
          title="Rooms"
          action={
            <>
              <UnreadBadge total={roomUnread.total} highlight={roomUnread.highlight} />
              {scope.kind === "space" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="browse rooms"
                      onClick={() => setBrowseOpen(true)}
                      className={SECTION_ICON_BUTTON_CLASS}
                    >
                      <CompassIcon />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Browse rooms</TooltipContent>
                </Tooltip>
              ) : null}
              {canCreateRoom ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="add room"
                      onClick={() => setCreateRoomOpen(true)}
                      className={SECTION_ICON_BUTTON_CLASS}
                    >
                      <PlusIcon />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Create room</TooltipContent>
                </Tooltip>
              ) : null}
            </>
          }
        >
          {roomList.map(row)}
        </Section>
        {subspaces.map((r) => (
          <SubspaceSection key={r.roomId} room={r} isAgent={isAgent} />
        ))}
        <Section
          title="DMs"
          defaultExpanded={false}
          action={
            <>
              <UnreadBadge total={dmUnread.total} highlight={dmUnread.highlight} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="start dm"
                    onClick={() => setCreateDmOpen(true)}
                    className={SECTION_ICON_BUTTON_CLASS}
                  >
                    <PlusIcon />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Start a direct message</TooltipContent>
              </Tooltip>
            </>
          }
        >
          {dmList.map(row)}
        </Section>
      </SidebarContent>
      {overflow.below.count > 0 ? (
        <MoreUnreadButton
          count={overflow.below.count}
          emphasis={overflow.below.highlight ? "primary" : "default"}
          onClick={() => scrollTo("bottom")}
          position="bottom"
        />
      ) : null}
      {scope.kind === "space" ? (
        <>
          <CreateRoomDialog
            open={createRoomOpen}
            spaceId={scope.spaceId}
            onOpenChange={setCreateRoomOpen}
          />
          <BrowseRoomsDialog open={browseOpen} spaceId={scope.spaceId} onOpenChange={setBrowseOpen} />
        </>
      ) : null}
      {workforceSpaceId ? (
        <CreateDmDialog
          open={createDmOpen}
          spaceId={workforceSpaceId}
          onOpenChange={setCreateDmOpen}
        />
      ) : null}
    </div>
  );
}
