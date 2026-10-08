import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppShortcuts } from "./use-app-shortcuts";

const press = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));

describe("useAppShortcuts", () => {
  it("⌘G / Ctrl+G opens search, ⌘K the switcher", () => {
    const onSearch = vi.fn();
    const onQuickSwitch = vi.fn();
    renderHook(() =>
      useAppShortcuts({ onSearch, onQuickSwitch, onNavigateRoom: vi.fn(), onMarkAllRead: vi.fn() }),
    );
    press({ key: "g", metaKey: true });
    press({ key: "g", ctrlKey: true });
    press({ key: "k", metaKey: true });
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onQuickSwitch).toHaveBeenCalledTimes(1);
  });
});
