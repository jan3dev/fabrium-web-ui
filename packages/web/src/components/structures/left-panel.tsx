import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { Sidebar } from "./sidebar/sidebar";
import type { Scope } from "./sidebar/scope";

interface LeftPanelProps {
  scope: Scope;
  workforceSpaceId: string | null;
}

export function LeftPanel({ scope, workforceSpaceId }: LeftPanelProps) {
  const { setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const lastPathname = useRef(pathname);

  // Close the mobile sheet once a row navigates. Compare paths rather than
  // skipping the first run: this mounts as the sheet opens, and StrictMode
  // replays effects, which would close it again straight away.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return <Sidebar scope={scope} workforceSpaceId={workforceSpaceId} />;
}
