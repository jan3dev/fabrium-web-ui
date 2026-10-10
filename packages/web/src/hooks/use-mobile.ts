// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/hooks/use-mobile.tsx. Modified.
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Returns `true` when the viewport is narrower than `breakpointPx`.
 * Uses `matchMedia` for efficient change detection.
 */
export function useMediaBreakpoint(breakpointPx: number): boolean {
  const [isBelow, setIsBelow] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpointPx : false,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const onChange = () => {
      setIsBelow(window.innerWidth < breakpointPx);
    };
    mql.addEventListener("change", onChange);
    setIsBelow(window.innerWidth < breakpointPx);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpointPx]);

  return isBelow;
}

/** Below `md`: the sidebar is a sheet and the right pane covers the screen. */
export function useIsMobile() {
  return useMediaBreakpoint(MOBILE_BREAKPOINT);
}
