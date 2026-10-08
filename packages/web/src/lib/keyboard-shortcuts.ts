// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/lib/keyboard-shortcuts.ts. Modified.

export type KeyboardShortcut = {
  id: string;
  label: string;
  /** One entry per key, for one `<Kbd>` each. */
  keys: string[];
  keysWindows: string[];
};

/** App-wide shortcuts, bound in `hooks/use-app-shortcuts.ts` and the sidebar. */
export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: "quick-switcher",
    label: "Jump to a room",
    keys: ["⌘", "K"],
    keysWindows: ["Ctrl", "K"],
  },
  {
    id: "search",
    label: "Search messages",
    // Not ⌘/: "/" needs Shift on German and other layouts, where it never fires.
    keys: ["⌘", "G"],
    keysWindows: ["Ctrl", "G"],
  },
  {
    id: "previous-room",
    label: "Previous room",
    keys: ["⌥", "↑"],
    keysWindows: ["Alt", "↑"],
  },
  {
    id: "next-room",
    label: "Next room",
    keys: ["⌥", "↓"],
    keysWindows: ["Alt", "↓"],
  },
  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    keys: ["⌘", "B"],
    keysWindows: ["Ctrl", "B"],
  },
  {
    id: "close-pane",
    label: "Close the side panel",
    keys: ["Esc"],
    keysWindows: ["Esc"],
  },
  {
    id: "mark-all-read",
    label: "Mark all as read",
    keys: ["⇧", "Esc"],
    keysWindows: ["Shift", "Esc"],
  },
];

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}

/** Platform key list for a shortcut, or null when the id is unknown. */
export function getPlatformKeysById(id: string): string[] | null {
  const shortcut = KEYBOARD_SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) return null;
  return isMacPlatform() ? shortcut.keys : shortcut.keysWindows;
}
