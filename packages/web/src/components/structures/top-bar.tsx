// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/app/AppTopChrome.tsx. Modified.
import { TopSearch } from "@/components/search/top-search";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useGlobalSearchEnabled } from "../../client/feature-flags";
import { RoomHeader, type RoomHeaderProps } from "./room-header";

/**
 * Strip above the sidebar and content: sidebar toggle and the search field. With `room`,
 * the open room's title and actions sit on either side of the search.
 */
export function TopBar({
  workforceSpaceId = null,
  room,
}: {
  workforceSpaceId?: string | null;
  room?: Omit<RoomHeaderProps, "children">;
}) {
  const searchEnabled = useGlobalSearchEnabled();
  // A spacer keeps the header's two sides apart when search is off.
  const search = searchEnabled ? <TopSearch workforceSpaceId={workforceSpaceId} /> : <span />;

  return (
    <div
      className="relative z-20 flex h-10 shrink-0 cursor-default items-center gap-2 bg-sidebar px-2 text-sidebar-foreground select-none"
      data-testid="top-bar"
    >
      <SidebarTrigger />
      {room ? <RoomHeader {...room}>{search}</RoomHeader> : search}
    </div>
  );
}
