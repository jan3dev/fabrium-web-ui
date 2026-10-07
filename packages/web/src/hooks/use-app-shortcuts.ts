// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/app/useAppShellKeyboardShortcuts.ts. Modified.
import * as React from "react";

type AppShortcutsOptions = {
  onQuickSwitch: () => void;
  /** Absent when global search is off. */
  onSearch?: () => void;
  onNavigateRoom: (delta: -1 | 1) => void;
  /** Absent when no side panel is open. */
  onClosePane?: () => void;
  onMarkAllRead: () => void;
};

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA")
  );
}

/**
 * Shell shortcuts: ⌘K switcher, ⌘/ search, Alt+↑/↓ room, Esc close pane,
 * ⇧Esc mark all read. Bubble phase, and skipped when something more specific
 * (a dialog, a menu, the composer) already handled the key.
 */
export function useAppShortcuts(options: AppShortcutsOptions) {
  const ref = React.useRef(options);
  ref.current = options;

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.defaultPrevented) return;
      const {
        onQuickSwitch,
        onSearch,
        onNavigateRoom,
        onClosePane,
        onMarkAllRead,
      } = ref.current;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && !event.shiftKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "k") {
          event.preventDefault();
          onQuickSwitch();
        } else if (key === "/" && onSearch) {
          event.preventDefault();
          onSearch();
        }
        return;
      }

      if (
        event.altKey &&
        !mod &&
        !event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        onNavigateRoom(event.key === "ArrowUp" ? -1 : 1);
        return;
      }

      if (event.key === "Escape" && !mod && !event.altKey) {
        if (event.shiftKey) {
          event.preventDefault();
          onMarkAllRead();
        } else if (onClosePane && !isEditable(event.target)) {
          event.preventDefault();
          onClosePane();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
