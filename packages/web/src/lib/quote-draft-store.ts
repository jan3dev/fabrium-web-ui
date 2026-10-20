import { useSyncExternalStore } from "react";
import type { QuoteRef } from "./matrix/quote";

/**
 * A per-composer draft, keyed by room + thread (null = room composer), that the
 * composer and whoever fills it (message actions, the artifact panel) share.
 */
export function keyedDraftStore<T>(empty: T) {
  const drafts = new Map<string, T>();
  const listeners = new Set<() => void>();
  const keyOf = (roomId: string, threadId: string | null) => `${roomId}|${threadId ?? ""}`;
  const emit = () => {
    for (const l of listeners) l();
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const get = (roomId: string, threadId: string | null): T => drafts.get(keyOf(roomId, threadId)) ?? empty;
  return {
    get,
    /** `empty` (or null) clears the draft. */
    set(roomId: string, threadId: string | null, draft: T | null) {
      const k = keyOf(roomId, threadId);
      if (draft !== null && draft !== empty) drafts.set(k, draft);
      else drafts.delete(k);
      emit();
    },
    use: (roomId: string, threadId: string | null): T =>
      useSyncExternalStore(subscribe, () => get(roomId, threadId), () => empty),
    reset() {
      drafts.clear();
      emit();
    },
  };
}

/** A quote waiting in a composer. */
export interface QuoteDraft {
  quote: QuoteRef;
  senderName: string;
}

const quotes = keyedDraftStore<QuoteDraft | null>(null);

export const setQuoteDraft = quotes.set;
export const getQuoteDraft = quotes.get;
export const useQuoteDraft = quotes.use;
/** Tests only. */
export const resetQuoteDrafts = quotes.reset;
