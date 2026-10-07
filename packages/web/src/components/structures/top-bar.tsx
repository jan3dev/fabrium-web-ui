// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/app/AppTopChrome.tsx. Modified.
import { Link } from "react-router-dom";

import { SearchIcon } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useGlobalSearchEnabled } from "../../client/feature-flags";
import { getPlatformKeysById } from "../../lib/keyboard-shortcuts";

/** Strip above the sidebar and content: sidebar toggle and the search entry point. */
export function TopBar() {
  const searchEnabled = useGlobalSearchEnabled();

  return (
    <div
      className="relative z-20 flex h-10 shrink-0 cursor-default items-center gap-2 bg-sidebar px-2 text-sidebar-foreground select-none"
      data-testid="top-bar"
    >
      <SidebarTrigger />
      {searchEnabled ? (
        <Link
          to="/search"
          className="mx-auto flex h-7 w-full max-w-md min-w-0 items-center gap-2 rounded-utility border border-sidebar-border bg-background px-2.5 text-body2 text-text-tertiary transition-colors hover:border-surface-border-secondary hover:text-text-secondary"
        >
          <SearchIcon className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">Search</span>
          <span className="hidden items-center gap-0.5 sm:flex" aria-hidden>
            {getPlatformKeysById("search")?.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </Link>
      ) : null}
    </div>
  );
}
