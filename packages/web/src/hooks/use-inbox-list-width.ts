// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/home/useResizableInboxListWidth.ts. Modified.
import * as React from "react";

const DEFAULT_WIDTH_PX = 365;
const MIN_WIDTH_PX = 300;
const MAX_WIDTH_PX = 520;
const STORAGE_KEY = "fabrium:inbox-width";

function clamp(width: number): number {
  return Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, width));
}

function readWidth(): number {
  try {
    const parsed = Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_WIDTH_PX;
  } catch {
    return DEFAULT_WIDTH_PX;
  }
}

/** The inbox list column's width: drag to resize, double-click to reset, kept across reloads. */
export function useInboxListWidth() {
  const [widthPx, setWidthPx] = React.useState(readWidth);

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(widthPx));
    } catch {
      // The width still holds for this session.
    }
  }, [widthPx]);

  const onResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthPx;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (move: PointerEvent) =>
        setWidthPx(clamp(startWidth + move.clientX - startX));
      const onUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onMove);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [widthPx],
  );

  const onResetWidth = React.useCallback(
    () => setWidthPx(DEFAULT_WIDTH_PX),
    [],
  );

  return { widthPx, onResizeStart, onResetWidth };
}
