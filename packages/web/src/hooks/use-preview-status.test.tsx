import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { appendLog, MAX_LOG_CHARS, usePreviewStatus } from "./use-preview-status";

describe("appendLog", () => {
  it("appends and keeps the newest 64 KB", () => {
    expect(appendLog("a", "b")).toBe("ab");
    const long = appendLog("x".repeat(MAX_LOG_CHARS), "tail");
    expect(long).toHaveLength(MAX_LOG_CHARS);
    expect(long.endsWith("tail")).toBe(true);
  });
});

const getPreview = vi.hoisted(() => vi.fn());
vi.mock("@/client/fabrium-api", async (orig) => ({
  ...(await orig<typeof import("@/client/fabrium-api")>()),
  getPreview,
}));

describe("usePreviewStatus", () => {
  it("replaces the log when the gateway resets it, instead of appending a second copy", async () => {
    vi.useFakeTimers();
    try {
      const info = { agent_id: "@a:t", name: "app", status: "running" };
      getPreview
        .mockResolvedValueOnce({ ...info, log: { offset: 10, text: "ready\n" } })
        .mockResolvedValueOnce({ ...info, log: { offset: 17, text: "ready\nmore\n", reset: true } });
      const { result } = renderHook(() => usePreviewStatus("@a:t", "app"));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(result.current.log).toBe("ready\n");
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(result.current.log).toBe("ready\nmore\n");
      expect(getPreview).toHaveBeenLastCalledWith("@a:t", "app", 10);
    } finally {
      vi.useRealTimers();
    }
  });
});
