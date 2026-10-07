import { useMemo, useState, type ReactNode } from "react";
import type { MatrixEvent } from "matrix-js-sdk";
import { toast } from "sonner";

import { ShareMessageDialog } from "@/components/dialogs/share-message";
import { MatrixClientPeg } from "@/client/peg";
import { allRoomEvents } from "@/hooks/use-timeline";
import { resolveEditedContent } from "@/lib/matrix/edits";
import {
  buildThreadLink,
  threadRootOf,
  threadTargetForEvent,
} from "@/lib/matrix/permalinks";
import {
  buildQuoteRef,
  joinQuoteFallback,
  splitQuoteFallback,
} from "@/lib/matrix/quote";
import { setQuoteDraft, type QuoteDraft } from "@/lib/quote-draft-store";
import type { ThreadSummary, TimelineMessage } from "@/model/types";
import type { MessageRowActions } from "./message-row";
import { sendEditEvent } from "./message-actions";

type SendEvent = (
  room: string,
  type: string,
  content: Record<string, unknown>,
) => Promise<unknown>;

function copy(text: string, message: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(message),
    () => toast.error("Couldn't copy: clipboard access denied"),
  );
}

/**
 * Binds message row actions to Matrix for one room. Returns the actions and the
 * share dialog they open, which the caller renders once.
 */
export function useMessageActions(
  roomId: string,
  {
    inThread = false,
    onOpenThread,
    threads,
  }: {
    /** Quotes go to the thread composer, and nothing offers to open a thread. */
    inThread?: boolean;
    onOpenThread?: (rootId: string) => void;
    /** Thread summaries by root, so a quoted root carries its reply count. */
    threads?: ReadonlyMap<string, ThreadSummary>;
  } = {},
): { actions: MessageRowActions; dialogs: ReactNode } {
  const [sharing, setSharing] = useState<QuoteDraft | null>(null);

  const actions = useMemo<MessageRowActions>(() => {
    // Read at call time: the client can arrive after the first render.
    const client = MatrixClientPeg.safeGet();
    const room = () => client?.getRoom(roomId) ?? null;
    const me = client?.getUserId() ?? "";
    const find = (id: string): MatrixEvent | undefined => {
      const r = room();
      return (
        r?.findEventById(id) ??
        (r ? allRoomEvents(r).find((ev) => ev.getId() === id) : undefined)
      );
    };
    const quoteDraft = (m: TimelineMessage): QuoteDraft | null => {
      const ev = find(m.id);
      if (!ev) return null;
      const original = ev.getContent() as { msgtype?: string };
      // Quoting a quote snapshots what its author wrote; with no comment, the nested snapshot stands in.
      const content = m.quote
        ? m.body
          ? { msgtype: original.msgtype, body: m.body }
          : m.quote.snapshot
        : {
            msgtype: original.msgtype,
            body: m.body,
            format: m.formattedBody ? "org.matrix.custom.html" : undefined,
            formatted_body: m.formattedBody,
          };
      return {
        quote: buildQuoteRef(ev, {
          content,
          replyCount: inThread ? 0 : (threads?.get(m.id)?.replyCount ?? 0),
        }),
        senderName: m.author.displayName,
      };
    };
    return {
      toggleReaction(m, emoji) {
        if (!client) return;
        const mine = m.reactions.find(
          (r) => r.emoji === emoji && r.reactedByMe,
        );
        if (mine?.myEventId) {
          void client.redactEvent(roomId, mine.myEventId);
          return;
        }
        void (client.sendEvent as unknown as SendEvent).call(
          client,
          roomId,
          "m.reaction",
          {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: m.id,
              key: emoji,
            },
          },
        );
      },
      openThread:
        inThread || !onOpenThread ? undefined : (m) => onOpenThread(m.id),
      async edit(m, body) {
        const ev = find(m.id);
        const r = room();
        if (!client || !ev || !r) return;
        let next = body;
        if (m.quote) {
          const current = (resolveEditedContent(ev, allRoomEvents(r)) ??
            ev.getContent()) as { body?: string };
          next = joinQuoteFallback(
            body,
            splitQuoteFallback(current.body ?? "").fallback,
          );
        }
        await sendEditEvent(client, roomId, m.id, next);
      },
      remove(m) {
        void client?.redactEvent(roomId, m.id);
      },
      share(m) {
        setSharing(quoteDraft(m));
      },
      copyLink(m) {
        const ev = find(m.id);
        if (ev)
          copy(
            buildThreadLink(window.location.origin, threadTargetForEvent(ev)),
            "Link copied",
          );
      },
      copyText(m) {
        copy(m.body, "Text copied");
      },
      quote(m) {
        const ev = find(m.id);
        const draft = quoteDraft(m);
        if (ev && draft)
          setQuoteDraft(roomId, inThread ? threadRootOf(ev) : null, draft);
      },
      retrySend(m) {
        const ev = find(m.id);
        const r = room();
        if (client && ev && r) void client.resendEvent(ev, r).catch(() => {});
      },
      cancelSend(m) {
        const ev = find(m.id);
        if (client && ev) client.cancelPendingEvent(ev);
      },
      canEdit: (m) => m.kind === "message" && m.author.id === me,
      canDelete(m) {
        if (m.author.id === me) return true;
        const ev = find(m.id);
        return (
          !!ev &&
          (room()?.currentState.maySendRedactionForEvent(ev, me) ?? false)
        );
      },
    };
  }, [roomId, inThread, onOpenThread, threads]);

  const dialogs = (
    <ShareMessageDialog
      open={sharing !== null}
      onOpenChange={(open) => !open && setSharing(null)}
      title={sharing?.quote.thread ? "Share thread" : "Share message"}
      draft={sharing}
    />
  );
  return { actions, dialogs };
}
