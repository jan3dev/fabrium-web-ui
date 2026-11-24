import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MatrixClientPeg } from "@/client/peg";
import { artifactSizeError, sendArtifactVersion } from "@/events/fabrium-artifact";
import type { ArtifactVersion } from "@/model/types";

/** Idle time before collected edits go out as one save (spec §5.2). */
export const DRAFT_IDLE_MS = 1500;

interface Step {
  text: string;
  summary: string;
}

/** One line for several edits sent as one save. */
const summarize = (s: readonly string[]) =>
  s.length === 1 ? s[0]! : `${s.at(-1)} and ${s.length - 1} more ${s.length === 2 ? "change" : "changes"}`;

/** Who wrote the content a version shows now: its newest save's author, else its own. */
export const headAuthor = (v: ArtifactVersion) => v.edited?.by ?? v.author;

/**
 * The signed-in user's edits to the latest version of one artifact (spec §5.2). Edits
 * collect in memory and autosave as one `dev.fabrium.artifact.version` event after 1.5 s
 * idle, or at once on `flush` (the panel calls it on tab change; window blur and unmount
 * call it here). The view model folds a person's event into the version before it, so a
 * save never makes a new version. Each save is based on the version's newest content
 * (`headEventId`). Undo and redo walk this session's edits; undoing an edit that was
 * already saved saves the older content again. Content from someone else clears the
 * history, unless edits are still unsaved: those go out based on the older content, and
 * the panel marks it.
 */
export function useArtifactDraft(
  roomId: string,
  threadRootId: string,
  latest: ArtifactVersion | undefined,
  latestText: string | null,
) {
  // The text shown instead of the latest version; null shows the latest.
  const [text, setText] = useState<string | null>(null);
  // Counts the content from others that replaced what is shown: fields keyed on it start over.
  const [generation, setGeneration] = useState(0);
  const s = useRef({
    /** The content the next save is made from: the latest version's head, or what this hook last sent. */
    base: null as { id: string; text: string } | null,
    text: null as string | null,
    /** Summaries of the edits not sent yet. */
    unsent: [] as string[],
    undo: [] as Step[],
    redo: [] as Step[],
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** Unmounted: an edit that still arrives is sent at once, never left on a timer. */
    closed: false,
    sending: 0,
    queue: Promise.resolve(),
    latest,
  });
  s.current.latest = latest;
  const me = MatrixClientPeg.safeGet()?.getUserId();

  useEffect(() => {
    const st = s.current;
    const head = latest?.headEventId;
    // A local echo has no event ID yet: it is this user's own save on its way.
    if (!latest || !head || latestText === null || head.startsWith("~") || st.base?.id === head) return;
    if (st.unsent.length > 0 || st.sending > 0) return;
    if (headAuthor(latest).id !== me) {
      st.undo = [];
      st.redo = [];
      setGeneration((g) => g + 1);
    }
    st.base = { id: head, text: latestText };
    st.text = null;
    setText(null);
  }, [latest, latestText, me]);

  /**
   * Sends a version after any send still in flight: the current text, or `over`'s. Rejects
   * after telling the user; nothing goes out when the text is the base's and nothing else changed.
   */
  const send = useCallback(
    (over: { identifier?: string; title?: string; text?: string; basedOn?: string; summary: string }) => {
      const st = s.current;
      st.sending++;
      const job = st.queue.then(async () => {
        const v = st.latest;
        const client = MatrixClientPeg.safeGet();
        const text = over.text ?? st.text ?? st.base?.text;
        try {
          if (!v || !client || !st.base || text == null) throw new Error("The artifact is not loaded.");
          if (!over.identifier && !over.title && text === st.base.text) return;
          const id = await sendArtifactVersion(client, roomId, threadRootId, {
            identifier: over.identifier ?? v.identifier,
            kind: v.kind,
            title: over.title ?? v.title,
            language: v.language,
            text,
            basedOn: over.basedOn ?? st.base.id,
            summary: over.summary,
          });
          if (!over.identifier) st.base = { id, text };
        } catch (err) {
          toast.error(`Could not save your change. ${err instanceof Error ? err.message : ""}`.trim());
          throw err;
        } finally {
          st.sending--;
        }
      });
      st.queue = job.catch(() => {});
      return job;
    },
    [roomId, threadRootId],
  );

  const flush = useCallback(() => {
    const st = s.current;
    clearTimeout(st.timer);
    if (st.unsent.length === 0 || st.text === null) return;
    const summaries = st.unsent;
    st.unsent = [];
    // A failed send keeps the edits: they go out with the next flush.
    send({ summary: summarize(summaries), text: st.text }).catch(() => {
      st.unsent = [...summaries, ...st.unsent];
    });
  }, [send]);

  const change = useCallback(
    (next: string, summary: string | null) => {
      const st = s.current;
      st.text = next;
      if (summary !== null) st.unsent.push(summary);
      setText(next);
      clearTimeout(st.timer);
      if (st.closed) flush();
      else st.timer = setTimeout(flush, DRAFT_IDLE_MS);
    },
    [flush],
  );

  /** Applies one edit to what the panel shows; false when it changed nothing or was refused. */
  const apply = useCallback(
    (edit: (text: string) => string, summary: string): boolean => {
      const st = s.current;
      const cur = st.text ?? st.base?.text;
      if (cur == null) return false;
      let next: string;
      try {
        next = edit(cur);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "That change could not be made.");
        return false;
      }
      if (next === cur) return false;
      const tooLarge = artifactSizeError(next);
      if (tooLarge) {
        toast.error(tooLarge);
        return false;
      }
      st.undo.push({ text: cur, summary });
      st.redo = [];
      change(next, summary);
      return true;
    },
    [change],
  );

  const step = useCallback(
    (from: "undo" | "redo") => {
      const st = s.current;
      const cur = st.text ?? st.base?.text;
      const target = st[from].pop();
      if (!target || cur == null) return false;
      st[from === "undo" ? "redo" : "undo"].push({ text: cur, summary: target.summary });
      // Undoing an edit that has not gone out drops it from the summary instead of adding "Undid".
      const undid = `Undid: ${target.summary}`;
      const [summary, reverts] = from === "undo" ? [undid, target.summary] : [target.summary, undid];
      if (st.unsent.at(-1) === reverts) {
        st.unsent.pop();
        change(target.text, null);
      } else change(target.text, summary);
      return true;
    },
    [change],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    s.current.closed = false;
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onHide);
      s.current.closed = true;
      flush();
    };
  }, [flush]);

  /** Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z and Ctrl+Y redo; true when the key was used. */
  const onKey = useCallback(
    (e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
      const key = e.key.toLowerCase();
      if (key === "z") return step(e.shiftKey ? "redo" : "undo");
      if (key === "y" && e.ctrlKey && !e.metaKey) return step("redo");
      return false;
    },
    [step],
  );

  return { text, generation, apply, flush, send, onKey };
}
