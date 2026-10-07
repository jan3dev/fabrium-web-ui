// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/layout/AuxiliaryPanelShell.tsx. Modified.
import * as React from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import { AUX_PANEL_MIN_WIDTH_PX } from "@/hooks/use-aux-panel-width";
import { cn } from "@/lib/utils";

type AuxPanelContextValue = { onClose: () => void };

export const AuxPanelContext = React.createContext<AuxPanelContextValue | null>(
  null,
);

type AuxPanelProps = {
  canResetWidth?: boolean;
  children: React.ReactNode;
  className?: string;
  header?: React.ReactNode;
  label: string;
  onClose: () => void;
  onResetWidth?: () => void;
  onResizeStart?: React.PointerEventHandler<HTMLButtonElement>;
  testId?: string;
  widthPx: number;
};

/**
 * Right-side panel beside the main pane. Resizable from its left edge on
 * desktop; below `md` it covers the screen.
 */
export function AuxPanel({
  canResetWidth,
  children,
  className,
  header,
  label,
  onClose,
  onResetWidth,
  onResizeStart,
  testId,
  widthPx,
}: AuxPanelProps) {
  const isMobile = useIsMobile();
  const contextValue = React.useMemo(() => ({ onClose }), [onClose]);

  return (
    <AuxPanelContext.Provider value={contextValue}>
      <aside
        aria-label={label}
        className={cn(
          "flex shrink-0 flex-col bg-background",
          isMobile
            ? "fixed inset-0 z-40"
            : "relative h-full border-l border-border",
          className,
        )}
        data-testid={testId}
        // Never squeeze the main pane below the panel's own minimum.
        style={
          isMobile
            ? undefined
            : {
                width: `min(${widthPx}px, calc(100% - ${AUX_PANEL_MIN_WIDTH_PX}px))`,
              }
        }
      >
        {!isMobile && onResizeStart ? (
          <button
            aria-label="Resize panel"
            className="group/aux-panel-resize absolute inset-y-0 left-0 z-40 w-3 -translate-x-1/2 cursor-col-resize"
            onDoubleClick={canResetWidth ? onResetWidth : undefined}
            onPointerDown={onResizeStart}
            tabIndex={-1}
            title={
              canResetWidth
                ? "Drag to resize. Double-click to reset width."
                : "Drag to resize."
            }
            type="button"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/aux-panel-resize:bg-border" />
          </button>
        ) : null}
        {header}
        <div className="scrollbar-custom flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </aside>
    </AuxPanelContext.Provider>
  );
}
