// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/ui/sidebar.tsx. Modified.
import * as React from "react";
import { Slot } from "radix-ui";

import { PanelLeftIcon } from "@/components/icons";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const SIDEBAR_OPEN_STORAGE_KEY = "fabrium:sidebar-open";
const SIDEBAR_WIDTH_STORAGE_KEY = "fabrium:sidebar-width";
const SIDEBAR_WIDTH_DEFAULT = 300;
const SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE = 8;
const SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE = 28;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;
const SIDEBAR_WIDTH_MOBILE = "288px";
// ⌘S is the browser's save shortcut on the web, so the toggle stays on ⌘B.
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  isResizing: boolean;
  setIsResizing: (isResizing: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
};
const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

export function clampSidebarWidth(width: number) {
  return Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)),
  );
}

export function magnetizeSidebarWidth(width: number) {
  const offset = width - SIDEBAR_WIDTH_DEFAULT;
  const distance = Math.abs(offset);

  if (distance <= SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE) {
    return SIDEBAR_WIDTH_DEFAULT;
  }

  if (distance >= SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE) {
    return clampSidebarWidth(width);
  }

  // Ease out of the detent so 300px feels sticky without blocking resize.
  const progress =
    (distance - SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE) /
    (SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE -
      SIDEBAR_WIDTH_DEFAULT_SNAP_DISTANCE);
  const easedDistance =
    SIDEBAR_WIDTH_DEFAULT_MAGNET_DISTANCE * progress * progress;

  return clampSidebarWidth(
    SIDEBAR_WIDTH_DEFAULT + Math.sign(offset) * easedDistance,
  );
}

// Storage throws in some private windows; the sidebar must still render.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the in-memory value for this session.
  }
}

function readSidebarWidth() {
  const storedWidth = Number.parseInt(
    readStored(SIDEBAR_WIDTH_STORAGE_KEY) ?? "",
    10,
  );
  return Number.isFinite(storedWidth)
    ? clampSidebarWidth(storedWidth)
    : SIDEBAR_WIDTH_DEFAULT;
}

function SidebarProvider({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);
  const [sidebarWidth, setSidebarWidthState] = React.useState(readSidebarWidth);
  const [open, _setOpen] = React.useState(
    () => readStored(SIDEBAR_OPEN_STORAGE_KEY) !== "false",
  );

  const setOpen = React.useCallback((value: boolean) => {
    _setOpen(value);
    writeStored(SIDEBAR_OPEN_STORAGE_KEY, String(value));
  }, []);

  const setSidebarWidth = React.useCallback((value: number) => {
    const nextWidth = clampSidebarWidth(value);
    writeStored(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
    setSidebarWidthState(nextWidth);
  }, []);

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen(!open);
  }, [isMobile, open, setOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // Expose semantic state so Tailwind descendants can style both modes.
  const state = open ? "expanded" : "collapsed";
  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      isResizing,
      setIsResizing,
      sidebarWidth,
      setSidebarWidth,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      isResizing,
      sidebarWidth,
      setSidebarWidth,
      openMobile,
      toggleSidebar,
    ],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper flex h-full min-h-0 w-full",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** Left sidebar: offcanvas and resizable on desktop, a sheet below `md`. */
function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile, isResizing, state, openMobile, setOpenMobile } =
    useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width) gap-0 bg-sidebar p-0 text-sidebar-foreground"
          style={
            { "--sidebar-width": SIDEBAR_WIDTH_MOBILE } as React.CSSProperties
          }
          side="left"
          showCloseButton={false}
          // Focus the sheet, not its first button: that button's tooltip would cover the list.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>
              Workspaces, channels and direct messages.
            </SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer relative hidden text-sidebar-foreground md:block"
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === "collapsed" ? "offcanvas" : ""}
      data-resizing={isResizing}
    >
      {/* Sidebar gap on desktop; the offcanvas panel below also goes invisible so it never paints over the rail. */}
      <div
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[resizing=true]:transition-none",
          "group-data-[collapsible=offcanvas]:w-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-y-0 left-0 z-10 hidden h-full w-(--sidebar-width) transition-[left,width,visibility] duration-200 ease-linear group-data-[resizing=true]:transition-none md:flex",
          "group-data-[collapsible=offcanvas]:invisible group-data-[collapsible=offcanvas]:pointer-events-none group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          className="flex h-full w-full origin-top bg-sidebar transition-[opacity,scale,translate] duration-200 ease-linear motion-reduce:transition-none group-data-[collapsible=offcanvas]:translate-x-6 group-data-[collapsible=offcanvas]:scale-95 group-data-[collapsible=offcanvas]:opacity-0"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarTrigger({ className }: { className?: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <IconButton
      className={className}
      data-sidebar="trigger"
      icon={<PanelLeftIcon />}
      label="Toggle sidebar"
      onClick={toggleSidebar}
      size="small"
      tooltipSide="bottom"
    />
  );
}

/** Drag handle on the sidebar's right edge: pointer-drag resize with a detent at 300px. */
function SidebarRail({ className }: { className?: string }) {
  const { setIsResizing, setSidebarWidth, sidebarWidth, state } = useSidebar();
  const resizeStateRef = React.useRef<{
    hasDragged: boolean;
    pointerId: number;
    previousCursor: string;
    previousUserSelect: string;
    startWidth: number;
    startX: number;
  } | null>(null);

  const finishResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.documentElement.style.cursor = resizeState.previousCursor;
    document.body.style.userSelect = resizeState.previousUserSelect;
    setIsResizing(false);
    resizeStateRef.current = null;
  };

  return (
    <button
      type="button"
      data-sidebar="rail"
      aria-label="Resize sidebar"
      tabIndex={-1}
      disabled={state !== "expanded"}
      onPointerCancel={finishResize}
      onPointerDown={(event) => {
        if (event.button !== 0 || state !== "expanded") return;
        resizeStateRef.current = {
          hasDragged: false,
          pointerId: event.pointerId,
          previousCursor: document.documentElement.style.cursor,
          previousUserSelect: document.body.style.userSelect,
          startWidth: sidebarWidth,
          startX: event.clientX,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        setIsResizing(true);
      }}
      onPointerMove={(event) => {
        const resizeState = resizeStateRef.current;
        if (!resizeState || resizeState.pointerId !== event.pointerId) return;
        const delta = event.clientX - resizeState.startX;
        if (!resizeState.hasDragged && Math.abs(delta) < 3) return;
        resizeState.hasDragged = true;
        event.preventDefault();
        setSidebarWidth(magnetizeSidebarWidth(resizeState.startWidth + delta));
      }}
      onPointerUp={finishResize}
      title="Drag to resize sidebar"
      className={cn(
        "absolute inset-y-0 -right-4 z-20 hidden w-4 -translate-x-1/2 cursor-col-resize sm:flex",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-sidebar-border",
        "disabled:pointer-events-none disabled:hidden",
        className,
      )}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        // min-w-0: as a flex item beside the sidebar, the inset must be allowed
        // to shrink below its content's intrinsic width.
        "relative flex w-full min-w-0 flex-1 flex-col bg-background",
        className,
      )}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="content"
      className={cn(
        "scrollbar-custom flex min-h-0 flex-1 flex-col gap-2 overflow-auto [scrollbar-gutter:stable]",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-sidebar="group-label"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-utility px-2 text-caption1 font-medium text-sidebar-foreground/70 outline-hidden ring-sidebar-ring focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="group-content"
      className={cn("w-full text-body2", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

const SIDEBAR_MENU_BUTTON_CLASS =
  "peer/menu-button flex h-8 w-full items-center gap-2 overflow-hidden rounded-utility p-2 text-left text-body2 outline-hidden ring-sidebar-ring transition-[background-color,box-shadow] duration-100 ease-out motion-reduce:transition-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-active data-[active=true]:font-semibold data-[active=true]:text-sidebar-active-foreground data-[active=true]:hover:bg-sidebar-active data-[active=true]:hover:text-sidebar-active-foreground data-[state=open]:hover:bg-sidebar-accent [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0";

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-sidebar="menu-button"
      data-active={isActive}
      className={cn(SIDEBAR_MENU_BUTTON_CLASS, className)}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
};
