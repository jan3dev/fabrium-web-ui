import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MatrixClientPeg } from "@/client/peg";
import { MAX_ARTIFACT_BYTES, sha256Hex } from "@/events/fabrium-artifact";
import { fetchAuthedMedia } from "@/lib/matrix/authed-media";
import type { ArtifactVersion } from "@/model/types";
import { useThreadEntries } from "./use-timeline-entries";

/** The side panels beside a thread: an artifact or a preview, one at a time. */
const PANEL_KEYS = ["artifact", "version", "preview"];

/** Search params with `id` as the open thread; artifacts and previews belong to their thread, so a new thread closes them. */
export function withThread(prev: URLSearchParams, id: string): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.set("thread", id);
  next.delete("event");
  next.delete("pane");
  if (prev.get("thread") !== id) for (const k of PANEL_KEYS) next.delete(k);
  return next;
}

/** Search params with one side panel open, beside `threadId` when given; it closes the other panel. */
export function withPanel(
  prev: URLSearchParams,
  threadId: string | null | undefined,
  panel: Record<string, string>,
): URLSearchParams {
  const next =
    threadId && prev.get("thread") !== threadId ? withThread(prev, threadId) : new URLSearchParams(prev);
  for (const k of PANEL_KEYS) next.delete(k);
  for (const [k, v] of Object.entries(panel)) next.set(k, v);
  return next;
}

/**
 * The open artifact lives in the URL beside `?thread=`: `?artifact=<identifier>`
 * and `&version=<event id>` (absent = the latest version).
 */
export function useArtifactRoute() {
  const [params, setParams] = useSearchParams();
  const open = useCallback(
    (identifier: string, versionEventId?: string, threadId?: string | null) =>
      setParams((prev) =>
        withPanel(
          prev,
          threadId,
          versionEventId ? { artifact: identifier, version: versionEventId } : { artifact: identifier },
        ),
      ),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("artifact");
        next.delete("version");
        return next;
      }),
    [setParams],
  );
  return {
    identifier: params.get("artifact"),
    versionEventId: params.get("version"),
    open,
    close,
  };
}

/** Every artifact version in a thread, oldest first. */
export function useThreadArtifacts(
  roomId: string,
  threadRootId: string,
  workforceSpaceId: string | null,
): ArtifactVersion[] {
  const { replies } = useThreadEntries(roomId, threadRootId, workforceSpaceId);
  return useMemo(
    () =>
      replies
        .filter((m) => m.kind === "artifact")
        .map((m) => m.raw as ArtifactVersion),
    [replies],
  );
}

/** Fetched media texts by head event id (the content a version shows); the oldest goes past `MAX_CACHED`. */
const texts = new Map<string, Promise<string>>();
const MAX_CACHED = 16;

function loadText(version: ArtifactVersion): Promise<string> {
  const hit = texts.get(version.headEventId);
  if (hit) return hit;
  const client = MatrixClientPeg.safeGet();
  const pending = (async () => {
    if (!client || !version.mxc)
      throw new Error("The artifact has no content.");
    const buf = await (
      await fetchAuthedMedia(client, version.mxc)
    ).arrayBuffer();
    if (buf.byteLength > MAX_ARTIFACT_BYTES)
      throw new Error("The artifact is too large to show.");
    // The event pins the bytes; media that does not match was swapped.
    if ((await sha256Hex(buf)) !== version.sha256)
      throw new Error("The artifact content does not match its checksum.");
    return new TextDecoder().decode(buf);
  })();
  pending.catch(() => texts.delete(version.headEventId));
  texts.set(version.headEventId, pending);
  if (texts.size > MAX_CACHED) texts.delete(texts.keys().next().value!);
  return pending;
}

/** A version's content: inline, or fetched from the media repo. */
export function useArtifactText(version: ArtifactVersion | undefined): {
  text: string | null;
  error: string | null;
} {
  const [state, setState] = useState<{
    id: string;
    text: string | null;
    error: string | null;
  }>({
    id: "",
    text: null,
    error: null,
  });
  useEffect(() => {
    if (!version || version.body !== undefined) return;
    let live = true;
    loadText(version).then(
      (text) => live && setState({ id: version.headEventId, text, error: null }),
      (err: unknown) =>
        live &&
        setState({
          id: version.headEventId,
          text: null,
          error: err instanceof Error ? err.message : String(err),
        }),
    );
    return () => {
      live = false;
    };
  }, [version]);
  if (!version) return { text: null, error: null };
  if (version.body !== undefined) return { text: version.body, error: null };
  return state.id === version.headEventId ? state : { text: null, error: null };
}
