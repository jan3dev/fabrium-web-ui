// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/hooks/useThreadPanelWidth.ts. Modified.
import * as React from "react";

export const AUX_PANEL_DEFAULT_WIDTH_PX = 380;
export const AUX_PANEL_MIN_WIDTH_PX = 300;
const AUX_PANEL_MAX_WIDTH_PX = 720;
const AUX_PANEL_WIDTH_STORAGE_KEY = "fabrium:aux-width";

/**
 * Upper bound for the panel width. On ultrawide displays the static cap is too
 * small, so the panel may grow with the viewport while always leaving
 * {@link AUX_PANEL_MIN_WIDTH_PX} for the main pane.
 */
function maxWidth(): number {
  return Math.max(
    AUX_PANEL_MAX_WIDTH_PX,
    window.innerWidth - AUX_PANEL_MIN_WIDTH_PX,
  );
}

export function clampAuxPanelWidth(width: number): number {
  return Math.max(AUX_PANEL_MIN_WIDTH_PX, Math.min(maxWidth(), width));
}

function readInitialWidth(): number {
  try {
    const parsed = Number.parseInt(
      localStorage.getItem(AUX_PANEL_WIDTH_STORAGE_KEY) ?? "",
      10,
    );
    return Number.isFinite(parsed)
      ? clampAuxPanelWidth(parsed)
      : AUX_PANEL_DEFAULT_WIDTH_PX;
  } catch {
    return AUX_PANEL_DEFAULT_WIDTH_PX;
  }
}

/** Width of the right pane: drag to resize, double-click to reset, kept across reloads. */
export function useAuxPanelWidth() {
  const [widthPx, setWidthPx] = React.useState(readInitialWidth);

  React.useEffect(() => {
    try {
      localStorage.setItem(AUX_PANEL_WIDTH_STORAGE_KEY, String(widthPx));
    } catch {
      // Keep the in-memory width for this session.
    }
  }, [widthPx]);

  const onResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = widthPx;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setWidthPx(clampAuxPanelWidth(startWidth + startX - moveEvent.clientX));
      };

      const handlePointerEnd = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
    },
    [widthPx],
  );

  const onResetWidth = React.useCallback(
    () => setWidthPx(AUX_PANEL_DEFAULT_WIDTH_PX),
    [],
  );

  return {
    canReset: widthPx !== AUX_PANEL_DEFAULT_WIDTH_PX,
    onResetWidth,
    onResizeStart,
    widthPx,
  };
}
