import { useCallback, useEffect, useState } from "react";
import {
  Outlet,
  useMatch,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { QuickSwitcher } from "@/components/dialogs/quick-switcher";
import { focusTopSearch } from "@/components/search/top-search";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { useNotifications } from "@/hooks/use-notifications";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useClearRoomNotifications } from "@/hooks/use-clear-room-notifications";
import { useServiceWorkerMessages } from "@/hooks/use-service-worker-messages";
import {
  Sidebar,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useGlobalSearchEnabled } from "../../client/feature-flags";
import { MatrixClientPeg } from "../../client/peg";
import { DEFAULT_WORKFORCE_SPACE } from "../../client/runtime-config";
import { useActiveSpaceId } from "../../hooks/use-active-space-id";
import { useAppShortcuts } from "../../hooks/use-app-shortcuts";
import { useJoinedSpaces } from "../../hooks/use-joined-spaces";
import { markAllRead } from "../../hooks/use-mark-read";
import { useMatrixClient } from "../../hooks/use-matrix-client";
import { WorkforceSpaceContext } from "../../hooks/use-workforce";
import { useIsMobile } from "../../hooks/use-mobile";
import { LeftPanel } from "./left-panel";
import { RightPane, type PaneView, parsePaneView } from "./right-pane";
import { RoomHeader } from "./room-header";
import { SidebarProfileCard } from "./sidebar/profile-card";
import type { Scope } from "./sidebar/scope";
import { ThreadPane } from "./thread-pane";
import { TopBar } from "./top-bar";
import { WorkspaceRail } from "./workspace-rail";

export interface LoggedInOutletContext {
  spaceId: string | null;
  activeScope: Scope;
  setScope: (scope: Scope) => void;
}

export interface LoggedInViewProps {
  pushGatewayUrl?: string;
  vapidPublicKey?: string;
  workforceSpace?: string;
}

const SCOPE_STORAGE_KEY = "fabrium:workspace";

function readStoredScope(): Scope | null {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (raw === "home") return { kind: "home" };
    return raw ? { kind: "space", spaceId: raw } : null;
  } catch {
    return null;
  }
}

/** Rooms in sidebar order, read from the rendered rows so it always matches what the user sees. */
function sidebarRoomIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-room-id]"),
    (el) => el.dataset.sidebarRoomId!,
  );
}

export function LoggedInView({
  pushGatewayUrl,
  vapidPublicKey,
  workforceSpace,
}: LoggedInViewProps = {}) {
  const client = useMatrixClient();
  const userId = client.getUserId() ?? "";
  const serverName = userId.split(":")[1] ?? userId;
  const spaceLocalpart = workforceSpace ?? DEFAULT_WORKFORCE_SPACE;
  const { ready: workforceSpaceReady, spaceId } = useActiveSpaceId(
    spaceLocalpart,
    serverName,
  );
  const joinedSpaces = useJoinedSpaces();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const searchEnabled = useGlobalSearchEnabled();
  const [scope, setScopeState] = useState<Scope | null>(readStoredScope);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const push = usePushSubscription({
    push_gateway_url: pushGatewayUrl,
    vapid_public_key: vapidPublicKey,
  });
  useNotifications(push.subscribed);
  useServiceWorkerMessages();
  const roomMatch = useMatch("/room/:roomId");
  const roomId = roomMatch?.params.roomId ?? null;
  useClearRoomNotifications(roomId);
  const [searchParams, setSearchParams] = useSearchParams();
  // One right pane at a time: an open thread wins over `?pane=`.
  const threadId = roomId ? searchParams.get("thread") : null;
  const pane =
    roomId && !threadId ? parsePaneView(searchParams.get("pane")) : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { persistent, reason } = await MatrixClientPeg.whenStoreReady();
      if (cancelled) return;
      if (!persistent) {
        console.warn(
          `[logged-in-view] starting sync without persistent storage${reason ? `: ${reason}` : ""}`,
        );
      }
      // initialSyncLimit only applies when there is no saved sync to resume
      // from; with IndexedDB warm we resume from the stored token instead.
      client.startClient({ initialSyncLimit: 10 }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const setScope = useCallback((next: Scope) => {
    setScopeState(next);
    try {
      localStorage.setItem(
        SCOPE_STORAGE_KEY,
        next.kind === "home" ? "home" : next.spaceId,
      );
    } catch {
      // The choice still holds for this session.
    }
  }, []);

  // Workforce space didn't resolve — if the user only belongs to one space,
  // scope to it instead of stranding them on Home (ZNC008).
  const defaultScope: Scope = spaceId
    ? { kind: "space", spaceId }
    : workforceSpaceReady && joinedSpaces.length === 1
      ? { kind: "space", spaceId: joinedSpaces[0].roomId }
      : { kind: "home" };
  // The remembered choice wins once its space is known; a space since left falls back.
  const activeScope: Scope =
    scope &&
    (scope.kind === "home" ||
      joinedSpaces.some((s) => s.roomId === scope.spaceId))
      ? scope
      : defaultScope;
  const workspaceName =
    activeScope.kind === "home"
      ? "Home"
      : (joinedSpaces.find((s) => s.roomId === activeScope.spaceId)?.name ??
        "Workspace");

  const setPane = (view: PaneView | null) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view) next.set("pane", view);
      else next.delete("pane");
      next.delete("thread");
      next.delete("event");
      return next;
    });
  const togglePane = (view: PaneView) => setPane(pane === view ? null : view);

  useAppShortcuts({
    onQuickSwitch: () => setSwitcherOpen(true),
    onSearch: searchEnabled ? focusTopSearch : undefined,
    onNavigateRoom: (delta) => {
      const ids = sidebarRoomIds();
      if (ids.length === 0) return;
      const at = roomId ? ids.indexOf(roomId) : -1;
      const nextIndex =
        at === -1
          ? delta > 0
            ? 0
            : ids.length - 1
          : Math.min(Math.max(at + delta, 0), ids.length - 1);
      if (nextIndex !== at) navigate(`/room/${ids[nextIndex]}`);
    },
    onClosePane: pane || threadId ? () => setPane(null) : undefined,
    onMarkAllRead: () => markAllRead(),
  });

  const rail = <WorkspaceRail scope={activeScope} onSelect={setScope} />;

  return (
    <WorkforceSpaceContext.Provider value={spaceId}>
      <SidebarProvider className="h-svh overflow-hidden bg-sidebar">
        {isMobile ? null : rail}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar workforceSpaceId={spaceId} />
          <div className="relative flex min-h-0 flex-1">
            <Sidebar>
              {isMobile ? rail : null}
              <div className="flex min-w-0 flex-1 flex-col">
                <LeftPanel scope={activeScope} workforceSpaceId={spaceId} />
                <SidebarFooter>
                  <SidebarProfileCard
                    workspaceName={workspaceName}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                </SidebarFooter>
              </div>
              {isMobile ? null : <SidebarRail />}
            </Sidebar>
            <SidebarInset
              data-testid="logged-in-view"
              className="overflow-hidden border-border md:rounded-tl-card md:border-t md:border-l"
            >
              {roomId ? (
                <RoomHeader
                  workforceSpaceId={spaceId}
                  membersOpen={pane === "members"}
                  infoOpen={pane === "info"}
                  onToggleMembers={() => togglePane("members")}
                  onToggleInfo={() => togglePane("info")}
                />
              ) : null}
              <div className="relative flex min-h-0 flex-1">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <Outlet
                    context={
                      {
                        spaceId,
                        activeScope,
                        setScope,
                      } satisfies LoggedInOutletContext
                    }
                  />
                </div>
                {roomId && threadId ? (
                  <ThreadPane
                    key={`${roomId}:${threadId}`}
                    roomId={roomId}
                    rootEventId={threadId}
                    highlightEventId={searchParams.get("event") ?? undefined}
                    workforceSpaceId={spaceId}
                    onClose={() => setPane(null)}
                  />
                ) : roomId && pane ? (
                  <RightPane
                    roomId={roomId}
                    spaceId={spaceId}
                    view={pane}
                    onNavigate={setPane}
                    onClose={() => setPane(null)}
                  />
                ) : null}
              </div>
            </SidebarInset>
          </div>
        </div>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pushGatewayUrl={pushGatewayUrl}
          vapidPublicKey={vapidPublicKey}
        />
        <QuickSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
      </SidebarProvider>
    </WorkforceSpaceContext.Provider>
  );
}
