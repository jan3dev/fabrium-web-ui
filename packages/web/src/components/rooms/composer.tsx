import { useEffect, useRef, useState } from "react";
import { EventStatus, type MatrixEvent, type Room } from "matrix-js-sdk";
import { parseSlashCommand } from "@/lib/slash-commands";
import { ArtifactRefChips } from "@/components/artifacts/artifact-refs";
import {
  appendArtifactRefs,
  ARTIFACT_REFS_FIELD,
  formatArtifactRefs,
  getArtifactRefDrafts,
  QUIET_FIELD,
  setArtifactRefDrafts,
  useArtifactRefDrafts,
  wireRef,
} from "@/lib/artifacts/refs";
import { buildQuoteContent } from "@/lib/matrix/quote";
import { setComposerFill, setQuoteDraft, useComposerFill, useQuoteDraft } from "@/lib/quote-draft-store";
import { QuoteChip } from "./quote-chip";
import { CreateChip, CreateExamples, CreateMenu } from "./create-menu";
import {
  ARTIFACT_HINT_FIELD,
  createLine,
  type CreateType,
  parseCreateCommand,
  stripCreateCommand,
} from "@/lib/artifacts/hint";
import { DesignSystemChip } from "./design-system-chip";
import { activeDesignSystem, DesignSystemContentKey, designSystemChoice } from "@/events/fabrium-design-systems";
import { useDesignSystems } from "../../hooks/use-design-systems";
import { MessageInput, type MessageInputHandle, type MessageInputSubmit } from "./message-input";
import { useMatrixClient } from "../../hooks/use-matrix-client";
import { allRoomEvents } from "../../hooks/use-timeline";
import { useMediaUpload } from "../../hooks/use-media-upload";

export interface ComposerProps {
  roomId: string;
  threadRootEventId?: string | null;
  /** Agents in this workforce come first in `@` suggestions. */
  workforceSpaceId?: string | null;
}

type SendEvent = (
  roomId: string,
  threadId: string | null,
  type: string,
  content: Record<string, unknown>,
) => Promise<{ event_id: string }>;

const notSentEchoes = (room: Room | null): MatrixEvent[] =>
  room ? allRoomEvents(room).filter((ev) => ev.status === EventStatus.NOT_SENT) : [];

export function Composer({ roomId, threadRootEventId, workforceSpaceId = null }: ComposerProps) {
  const client = useMatrixClient();
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const { upload, progress } = useMediaUpload();
  // Spec §5.6: the chip names the system new work uses; a personal choice rides on the message.
  const designSystems = useDesignSystems(workforceSpaceId, roomId);

  const threadScoped = Boolean(threadRootEventId);
  const threadId = threadRootEventId ?? null;
  const quoteDraft = useQuoteDraft(roomId, threadId);
  const refDrafts = useArtifactRefDrafts(roomId, threadId);
  const hasRefs = refDrafts.length > 0;
  const input = useRef<MessageInputHandle>(null);
  // Explicit mode (spec §6.8): the kind the next message asks for, from the Create menu or `/slides`.
  // Kept per room and thread: another one starts with none.
  const hintAt = `${roomId} ${threadId}`;
  const [hintState, setHintState] = useState<{ at: string; type: CreateType | null }>({ at: hintAt, type: null });
  const hint = hintState.at === hintAt ? hintState.type : null;
  const setHint = (type: CreateType | null) => setHintState({ at: hintAt, type });
  // Example prompts show while the field is empty (spec §3.1).
  const [typed, setTyped] = useState(false);
  // The daemon picks the default per kind, so the chip names the one the hinted kind gets.
  const activeSystem = activeDesignSystem(
    designSystems.systems,
    designSystems.prefs,
    hint === "slides" || hint === "design" || hint === "motion" ? hint : undefined,
  );
  const fill = useComposerFill(roomId, threadId);
  // Text another view put here (a preview's "Ask agent to fix"): taken once, then cleared.
  useEffect(() => {
    if (!fill || !input.current) return;
    input.current.fill(fill.text, fill.mention);
    setComposerFill(roomId, threadId, null);
  }, [fill, roomId, threadId]);

  /**
   * Send one event. When the server rejects it, the SDK keeps a NOT_SENT local
   * echo in the timeline. For message content that tile owns the failure (reason,
   * Retry, Delete), so the error is swallowed here. Custom event types have no
   * tile that shows a failure, so their echo is dropped and the error rethrown
   * for the composer's error line.
   */
  async function sendEvent(
    type: string,
    content: Record<string, unknown>,
    { tile }: { tile: boolean },
  ): Promise<void> {
    const room = client.getRoom(roomId);
    const known = new Set(notSentEchoes(room));
    try {
      await (client.sendEvent as unknown as SendEvent).call(client, roomId, threadId, type, content);
    } catch (err) {
      const echoes = notSentEchoes(room).filter((ev) => !known.has(ev));
      if (tile && echoes.length > 0) return;
      for (const ev of echoes) client.cancelPendingEvent(ev);
      throw err;
    }
  }

  async function send({
    body,
    formattedBody,
    rawBody,
    mentionUserIds,
    attachments,
    setAttachments,
  }: MessageInputSubmit): Promise<void> {
    // Slash commands only apply when there's no attachment and the body starts with /
    if (rawBody && attachments.length === 0 && !quoteDraft && !hasRefs) {
      const slash = parseSlashCommand(rawBody, { threadScoped });
      if (slash) {
        // matrix-js-sdk auto-adds m.relates_to for m.room.message threaded
        // sends, but not for custom event types (dev.zooid.*). Set the
        // relation explicitly so the daemon can route by thread root.
        const slashContent = threadId
          ? {
              ...slash.content,
              "m.relates_to": { rel_type: "m.thread", event_id: threadId },
            }
          : slash.content;
        await sendEvent(slash.eventType, slashContent, { tile: false });
        return;
      }
    }

    // `/slides` alone picks the kind like the Create menu; `/slides <request>` sends it.
    const command = rawBody ? parseCreateCommand(rawBody) : null;
    if (command && !command.rest && attachments.length === 0 && !quoteDraft && !hasRefs) {
      setHint(command.type);
      return;
    }
    const createType = command?.type ?? hint;
    if (command) {
      body = stripCreateCommand(body);
      formattedBody = formattedBody && stripCreateCommand(formattedBody);
    }
    if (createType) {
      // The line is for clients that do not read the hint; the daemon reads the hint.
      const line = createLine(createType);
      body = body.trim() ? `${line}\n\n${body}` : line;
      formattedBody = formattedBody && `<p>${line}</p>${formattedBody}`;
    }

    // Send attachments first (before text), as per ZOD057 design. Uploads run
    // one at a time so the timeline order matches the tray order; anything
    // still unsent when one fails stays staged for a retry.
    if (attachments.length > 0) {
      const pending = [...attachments];
      try {
        while (pending.length > 0) {
          const { id, file } = pending[0];
          setUploadingId(id);
          const { contentUri } = await upload(file);
          const isImage = file.type.startsWith("image/");
          const mediaContent: Record<string, unknown> = {
            msgtype: isImage ? "m.image" : "m.file",
            body: file.name,
            url: contentUri,
            info: { mimetype: file.type, size: file.size },
          };
          if (!isImage) mediaContent.filename = file.name;
          await sendEvent("m.room.message", mediaContent, { tile: true });
          pending.shift();
        }
      } finally {
        setUploadingId(null);
        setAttachments(pending);
      }
    }

    // Comments with "Send to agent" off go first, on their own and quiet: they wake no agent (spec §6.6).
    const quietRefs = refDrafts.filter((r) => r.quiet);
    if (quietRefs.length > 0) {
      const refs = quietRefs.map(wireRef);
      await sendEvent(
        "m.room.message",
        { msgtype: "m.text", body: formatArtifactRefs(refs), [ARTIFACT_REFS_FIELD]: refs, [QUIET_FIELD]: true },
        { tile: true },
      );
      setArtifactRefDrafts(roomId, threadId, getArtifactRefDrafts(roomId, threadId).filter((r) => !quietRefs.includes(r)));
    }
    // The rest go in the reply, which mentions their agents.
    const toAgent = refDrafts.filter((r) => !r.quiet);
    if (body || quoteDraft || toAgent.length > 0) {
      // Annotations ride in `body` as plain text for the agent, before any
      // quote fallback; the HTML would not carry them, so it is dropped.
      const toAgentRefs = toAgent.map(wireRef);
      const comment = appendArtifactRefs(toAgent.length > 0 ? body.trim() : body, toAgentRefs);
      const content: Record<string, unknown> = quoteDraft
        ? buildQuoteContent({
            comment,
            quote: quoteDraft.quote,
            senderName: quoteDraft.senderName,
            origin: window.location.origin,
          })
        : formattedBody && toAgent.length === 0
          ? { msgtype: "m.text", body, format: "org.matrix.custom.html", formatted_body: formattedBody }
          : { msgtype: "m.text", body: comment };
      if (toAgent.length > 0) content[ARTIFACT_REFS_FIELD] = toAgentRefs;
      const mentions = [...new Set([...mentionUserIds, ...toAgent.flatMap((r) => (r.agent ? [r.agent] : []))])];
      if (createType) content[ARTIFACT_HINT_FIELD] = { type: createType };
      const dsChoice = designSystemChoice(designSystems.prefs, activeSystem);
      if (dsChoice) content[DesignSystemContentKey] = dsChoice;
      if (mentions.length > 0) {
        content["m.mentions"] = { user_ids: mentions };
      }
      await sendEvent("m.room.message", content, { tile: true });
      if (createType) setHint(null);
      if (quoteDraft) setQuoteDraft(roomId, threadId, null);
      // Only the sent ones: the panel may have added more while this was in flight.
      if (toAgent.length > 0)
        setArtifactRefDrafts(
          roomId,
          threadId,
          getArtifactRefDrafts(roomId, threadId).filter((r) => !toAgent.includes(r)),
        );
    }
  }

  const header = (
    <>
      {hint && <CreateChip type={hint} onRemove={() => setHint(null)} />}
      {hint && !typed && <CreateExamples type={hint} onPick={(prompt) => input.current?.fill(prompt)} />}
      {quoteDraft && (
        <QuoteChip draft={quoteDraft} onRemove={() => setQuoteDraft(roomId, threadId, null)} />
      )}
      <ArtifactRefChips
        refs={refDrafts}
        onRemove={(i) => setArtifactRefDrafts(roomId, threadId, refDrafts.filter((_, j) => j !== i))}
        onSendToAgent={(i, on) =>
          setArtifactRefDrafts(roomId, threadId, refDrafts.map((r, j) => (j === i ? { ...r, quiet: !on } : r)))
        }
      />
    </>
  );

  return (
    <MessageInput
      ref={input}
      roomId={roomId}
      workforceSpaceId={workforceSpaceId}
      className="shrink-0 px-3 pb-3"
      suggestionsClassName="left-3 right-3"
      threadScoped={threadScoped}
      allowEmpty={Boolean(quoteDraft) || hasRefs}
      uploadingId={uploadingId}
      uploadProgress={progress}
      error={error}
      onError={setError}
      header={header}
      tools={<CreateMenu value={hint} onPick={setHint} />}
      footer={<DesignSystemChip name={activeSystem?.name ?? null} />}
      placeholder={threadScoped ? "Reply in thread…" : undefined}
      onSubmit={send}
      onTextChange={(text) => setTyped(text.trim() !== "")}
    />
  );
}
