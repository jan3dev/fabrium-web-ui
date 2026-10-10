// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/app/AppTopChrome.tsx. Modified.
import { TopSearch } from "@/components/search/top-search";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useGlobalSearchEnabled } from "../../client/feature-flags";

/** Strip above the sidebar and content: sidebar toggle and the search field. */
export function TopBar({ workforceSpaceId = null }: { workforceSpaceId?: string | null }) {
  const searchEnabled = useGlobalSearchEnabled();

  return (
    <div
      className="relative z-20 flex h-10 shrink-0 cursor-default items-center gap-2 bg-sidebar px-2 text-sidebar-foreground select-none"
      data-testid="top-bar"
    >
      <SidebarTrigger />
      {searchEnabled ? <TopSearch workforceSpaceId={workforceSpaceId} /> : null}
    </div>
  );
}
