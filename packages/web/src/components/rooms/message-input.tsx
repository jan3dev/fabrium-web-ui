import {
  forwardRef,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { type ComposedLink, composeText } from "@/lib/matrix/compose";
import { nameOfMember } from "@/lib/sender";
import { listSlashCommands, type SlashCommandMeta } from "@/lib/slash-commands";
import { useAvailableCommands } from "../../hooks/use-available-commands";
import { useMembers } from "../../hooks/use-members";
import { useRoomList } from "../../hooks/use-room-list";
import { useWorkforce } from "../../hooks/use-workforce";
import {
  ComposerAttachments,
  DropZoneOverlay,
  nameClipboardFile,
  stageFiles,
  type StagedAttachment,
} from "./composer-attachments";
import { ComposerToolbar } from "./editor/composer-toolbar";
import { useRichTextEditor } from "./editor/use-rich-text-editor";
import {
  EmojiAutocomplete,
  type EmojiSuggestion,
  loadEmojiData,
  searchEmoji,
} from "./emoji-autocomplete";
import {
  MentionAutocomplete,
  type MentionSuggestion,
} from "./mention-autocomplete";
import { RoomAutocomplete, type RoomSuggestion } from "./room-autocomplete";
import { SlashCommandList } from "./slash-command-list";

const MAX_SUGGESTIONS = 8;

type AcMode = "mention" | "room" | "emoji" | "slash";

interface AutocompleteState {
  mode: AcMode;
  /** Plain-text offset of the trigger character. */
  start: number;
  query: string;
}

const TRIGGERS: Record<string, AcMode> = {
  "@": "mention",
  "#": "room",
  ":": "emoji",
};

/** The autocomplete the caret is in, if any. Exported for tests. */
export function detectAutocomplete(
  text: string,
  cursor: number,
  slashEnabled: boolean,
): AutocompleteState | null {
  // A slash command: the whole draft so far is one `/word` (blank lines
  // before it are trimmed on send anyway).
  const draft = text.trimStart();
  const lead = text.length - draft.length;
  if (
    slashEnabled &&
    draft.startsWith("/") &&
    cursor > lead &&
    !/\s/.test(draft)
  ) {
    return { mode: "slash", start: lead, query: text.slice(lead + 1, cursor) };
  }
  // Walk back from the caret to an unclosed trigger at a word start.
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (/\s/.test(ch)) return null;
    const mode = TRIGGERS[ch];
    if (!mode) continue;
    if (i > 0 && !/[\s(]/.test(text[i - 1])) return null;
    const query = text.slice(i + 1, cursor);
    // Typing a full user ID (`@bob:server`) needs no suggestion.
    if (mode === "mention" && query.includes(":")) return null;
    // `:` also ends sentences ("re: …"); wait for two shortcode characters.
    if (mode === "emoji" && !/^[a-z0-9_+-]{2,}$/i.test(query)) return null;
    return { mode, start: i, query };
  }
  return null;
}

export interface MessageInputSubmit {
  /** Plain-text body: picked mentions as user IDs, Markdown as typed. */
  body: string;
  /** HTML for `formatted_body`, when the Markdown has formatting or pills. */
  formattedBody?: string;
  /** The Markdown as typed (trimmed), for callers that parse it, like slash commands. */
  rawBody: string;
  mentionUserIds: string[];
  attachments: StagedAttachment[];
  /** Replace the staged tray, e.g. with the files still unsent after a failed upload. */
  setAttachments: (next: StagedAttachment[]) => void;
}

export interface MessageInputProps {
  /** Mentions and agent slash commands resolve against this room's members. */
  roomId: string;
  /** Agents in this workforce are listed first in `@` suggestions. */
  workforceSpaceId?: string | null;
  /**
   * Called on Enter or the send button. The caller does the sending. The input
   * clears once it resolves; if it throws, the text stays and `onError` gets the message.
   */
  onSubmit: (submit: MessageInputSubmit) => void | Promise<void>;
  slashCommands?: boolean;
  /** Scopes the client slash commands to the ones valid inside a thread. */
  threadScoped?: boolean;
  attachments?: boolean;
  /** Which attachment is uploading, and how far along (0..1), for the tray. */
  uploadingId?: string | null;
  uploadProgress?: number;
  /** Let an empty submit through, for callers with content besides the text (a quote). */
  allowEmpty?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Show the send button in the toolbar. */
  sendButton?: boolean;
  error?: string | null;
  onError?: (message: string | null) => void;
  /** Rendered between the error and the field, e.g. a quote chip. */
  header?: ReactNode;
  className?: string;
  /** Positioning for the suggestion list, which opens above the root. */
  suggestionsClassName?: string;
}

export interface MessageInputHandle {
  /** Submit what's typed, as if Enter were pressed. For a send button outside the input. */
  submit: () => Promise<void>;
}

/** The rich-text composer field: TipTap editor, autocompletes, attachments, toolbar. */
export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(
  function MessageInput(
    {
      roomId,
      workforceSpaceId = null,
      onSubmit,
      slashCommands: slashEnabled = true,
      threadScoped = false,
      attachments: attachmentsEnabled = true,
      uploadingId = null,
      uploadProgress,
      allowEmpty = false,
      disabled = false,
      placeholder = "Send a message…",
      ariaLabel = "Message",
      sendButton = true,
      error = null,
      onError,
      header,
      className,
      suggestionsClassName = "left-0 right-0",
    },
    ref,
  ) {
    const [text, setText] = useState("");
    const [ac, setAc] = useState<AutocompleteState | null>(null);
    const [activeIdx, setActiveIdx] = useState(0);
    const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
    const [dragging, setDragging] = useState(false);
    const [formattingOpen, setFormattingOpen] = useState(false);
    const [emojiMatches, setEmojiMatches] = useState<EmojiSuggestion[]>([]);
    const dragDepth = useRef(0);
    const attachInputRef = useRef<HTMLInputElement>(null);
    // What each picked `@Label` / `#Label` points at, until the draft is sent.
    const pickedMentions = useRef<ComposedLink[]>([]);
    const pickedRooms = useRef<ComposedLink[]>([]);

    const rawMembers = useMembers(roomId);
    const roster = useWorkforce(workforceSpaceId ?? "");
    const members = useMemo<MentionSuggestion[]>(() => {
      const all = rawMembers.map((m) => ({
        userId: m.userId,
        // A member without a display name falls back to their user ID; the
          // `@` is the mention trigger, not part of the name.
          displayName: nameOfMember(m).replace(/^@/, ""),
        isAgent: roster.isAgent(m.userId),
      }));
      return [
        ...all.filter((m) => m.isAgent),
        ...all.filter((m) => !m.isAgent),
      ];
    }, [rawMembers, roster]);

    const rooms = useRoomList();
    const roomChoices = useMemo<RoomSuggestion[]>(
      () =>
        rooms
          .filter((r) => !r.isSpaceRoom() && r.getMyMembership() === "join")
          .map((r) => ({ roomId: r.roomId, name: r.name })),
      [rooms],
    );

    const advertised = useAvailableCommands(roomId);
    const slashList = useMemo(() => {
      if (!slashEnabled) return [];
      const client = listSlashCommands({ threadScoped });
      const clientNames = new Set(client.map((c) => c.name));
      const agent = advertised
        .filter((c) => !clientNames.has(c.name))
        .map((c) => ({
          name: c.name,
          description: c.description,
          source: "agent" as const,
        }));
      return [...client, ...agent];
    }, [slashEnabled, threadScoped, advertised]);

    const query = ac?.query.toLowerCase() ?? "";
    const mentionMatches = useMemo(
      () =>
        ac?.mode !== "mention"
          ? []
          : members
              .filter(
                (m) =>
                  m.userId.toLowerCase().includes(query) ||
                  m.displayName.toLowerCase().includes(query),
              )
              .slice(0, MAX_SUGGESTIONS),
      [ac?.mode, members, query],
    );
    const roomMatches = useMemo(
      () =>
        ac?.mode !== "room"
          ? []
          : roomChoices
              .filter((r) => r.name.toLowerCase().includes(query))
              .slice(0, MAX_SUGGESTIONS),
      [ac?.mode, roomChoices, query],
    );
    const slashMatches = useMemo<SlashCommandMeta[]>(
      () =>
        ac?.mode !== "slash"
          ? []
          : slashList.filter(
              (c) =>
                !query ||
                c.name.startsWith(query) ||
                c.description.toLowerCase().includes(query),
            ),
      [ac?.mode, slashList, query],
    );

    useEffect(() => {
      if (ac?.mode !== "emoji") {
        setEmojiMatches([]);
        return;
      }
      let live = true;
      void loadEmojiData().then((data) => {
        if (live) setEmojiMatches(searchEmoji(data, ac.query));
      });
      return () => {
        live = false;
      };
    }, [ac?.mode, ac?.query]);

    const matchCount = {
      mention: mentionMatches.length,
      room: roomMatches.length,
      emoji: emojiMatches.length,
      slash: slashMatches.length,
    }[ac?.mode ?? "mention"];
    const acOpen = ac !== null && matchCount > 0;

    function updateAutocomplete(next: AutocompleteState | null) {
      setAc((prev) => {
        if (
          prev?.mode === next?.mode &&
          prev?.start === next?.start &&
          prev?.query === next?.query
        ) {
          return prev;
        }
        if (prev?.mode !== next?.mode || prev?.start !== next?.start)
          setActiveIdx(0);
        return next;
      });
    }

    const editor = useRichTextEditor({
      placeholder,
      ariaLabel,
      editable: !disabled,
      highlight: useMemo(
        () => ({
          names: members.filter((m) => !m.isAgent).map((m) => m.displayName),
          agentNames: members
            .filter((m) => m.isAgent)
            .map((m) => m.displayName),
          roomNames: roomChoices.map((r) => r.name),
        }),
        [members, roomChoices],
      ),
      onUpdate: ({ text: next, cursor }) => {
        setText(next);
        updateAutocomplete(detectAutocomplete(next, cursor, slashEnabled));
      },
      onSubmit: () => void submit(),
      onPasteFiles: attachmentsEnabled
        ? (files) => addFiles(files.map((f) => nameClipboardFile(f)))
        : undefined,
    });

    // Caret moves (arrows, clicks) open or close suggestions without a doc change.
    const { editor: tiptap, getPlainTextAndCursor } = editor;
    useEffect(() => {
      const ed = tiptap;
      if (!ed) return;
      const onSelection = () => {
        const { text: t, cursor } = getPlainTextAndCursor();
        updateAutocomplete(detectAutocomplete(t, cursor, slashEnabled));
      };
      const onBlur = () => setAc(null);
      ed.on("selectionUpdate", onSelection);
      ed.on("blur", onBlur);
      return () => {
        ed.off("selectionUpdate", onSelection);
        ed.off("blur", onBlur);
      };
    }, [tiptap, getPlainTextAndCursor, slashEnabled]);

    /** Replace the trigger and query before the caret with `insert`. */
    function complete(insert: string) {
      if (!ac) return;
      const { cursor } = editor.getPlainTextAndCursor();
      editor.replacePlainTextRange(ac.start, cursor, insert);
      setAc(null);
    }

    function selectMention(m: MentionSuggestion) {
      pickedMentions.current.push({ label: m.displayName, target: m.userId });
      complete(`@${m.displayName} `);
    }

    function selectRoom(r: RoomSuggestion) {
      pickedRooms.current.push({ label: r.name, target: r.roomId });
      complete(`#${r.name} `);
    }

    function selectEmoji(e: EmojiSuggestion) {
      complete(`${e.native} `);
    }

    function selectSlash(cmd: SlashCommandMeta) {
      const { text: t } = editor.getPlainTextAndCursor();
      editor.replacePlainTextRange(0, t.length, `/${cmd.name} `);
      setAc(null);
    }

    function selectActive() {
      if (!ac) return;
      if (ac.mode === "mention") selectMention(mentionMatches[activeIdx]);
      else if (ac.mode === "room") selectRoom(roomMatches[activeIdx]);
      else if (ac.mode === "emoji") selectEmoji(emojiMatches[activeIdx]);
      else selectSlash(slashMatches[activeIdx]);
    }

    async function submit(): Promise<void> {
      if (disabled) return;
      const markdown = editor.getMarkdown().trim();
      if (!markdown && attachments.length === 0 && !allowEmpty) return;
      onError?.(null);
      try {
        const composed = composeText(markdown, {
          mentions: pickedMentions.current,
          rooms: pickedRooms.current,
          members,
        });
        await onSubmit({
          ...composed,
          rawBody: markdown,
          attachments,
          setAttachments,
        });
        editor.clearContent();
        pickedMentions.current = [];
        pickedRooms.current = [];
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    }

    useImperativeHandle(ref, () => ({ submit }));

    /** Single entry point for every way a file can reach the tray. */
    function addFiles(files: File[]) {
      if (!attachmentsEnabled || files.length === 0) return;
      setAttachments((current) => {
        const { staged, error: stageError } = stageFiles(current, files);
        onError?.(stageError);
        return staged;
      });
    }

    function removeAttachment(id: string) {
      setAttachments((current) => current.filter((a) => a.id !== id));
      if (attachInputRef.current) attachInputRef.current.value = "";
    }

    /**
     * Dragged text or a link also fires these events; only a drag carrying files
     * should light up the drop target or be swallowed by preventDefault().
     */
    function isFileDrag(e: DragEvent): boolean {
      return (
        attachmentsEnabled &&
        Array.from(e.dataTransfer?.types ?? []).includes("Files")
      );
    }

    function handleDragEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    }

    function handleDragOver(e: DragEvent) {
      if (!isFileDrag(e)) return;
      // Without this the browser navigates to the dropped file.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }

    function handleDragLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      // Moving between child elements fires leave/enter pairs; count depth so the
      // highlight only clears when the pointer leaves the input itself.
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    }

    function handleDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
    }

    /**
     * Capture phase: with suggestions open, the list owns the arrows, Enter, Tab
     * and Escape, so they must not reach the editor's own keymap.
     */
    function onKeyDownCapture(e: KeyboardEvent) {
      if (!acOpen || e.nativeEvent.isComposing) return;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "ArrowDown") {
        handled();
        setActiveIdx((i) => (i + 1) % matchCount);
      } else if (e.key === "ArrowUp") {
        handled();
        setActiveIdx((i) => (i - 1 + matchCount) % matchCount);
      } else if (e.key === "Escape") {
        handled();
        setAc(null);
      } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        handled();
        const cmd = slashMatches[activeIdx];
        // The full command typed and Enter pressed: send it as is.
        if (
          ac?.mode === "slash" &&
          e.key === "Enter" &&
          text.trim() === `/${cmd?.name}`
        ) {
          setAc(null);
          void submit();
        } else {
          selectActive();
        }
      }
    }

    function startMention() {
      const ed = editor.editor;
      if (!ed) return;
      const { text: t, cursor } = editor.getPlainTextAndCursor();
      const before = t[cursor - 1];
      ed.chain()
        .focus()
        .insertContent(before && !/\s/.test(before) ? " @" : "@")
        .run();
    }

    const hover = (i: number) => setActiveIdx(i);

    return (
      <div
        className={cn("relative", className)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDownCapture={onKeyDownCapture}
      >
        {error && (
          <div role="alert" className="mb-2 text-body2 text-accent-danger">
            {error}
          </div>
        )}
        {header}
        {acOpen && (
          <div
            className={cn(
              "absolute bottom-full z-30 mb-1",
              suggestionsClassName,
            )}
          >
            {ac.mode === "slash" ? (
              <SlashCommandList
                commands={slashMatches}
                activeIdx={activeIdx}
                onSelect={selectSlash}
                onHover={hover}
              />
            ) : ac.mode === "room" ? (
              <RoomAutocomplete
                suggestions={roomMatches}
                selectedIndex={activeIdx}
                onSelect={selectRoom}
                onHover={hover}
              />
            ) : ac.mode === "emoji" ? (
              <EmojiAutocomplete
                suggestions={emojiMatches}
                selectedIndex={activeIdx}
                onSelect={selectEmoji}
                onHover={hover}
              />
            ) : (
              <MentionAutocomplete
                suggestions={mentionMatches}
                selectedIndex={activeIdx}
                onSelect={selectMention}
                onHover={hover}
              />
            )}
          </div>
        )}
        <div
          className={cn(
            "relative rounded-card border border-border bg-surface-primary px-3 pt-2.5 pb-1.5 transition-colors",
            "focus-within:border-surface-border-selected",
            disabled && "opacity-60",
          )}
        >
          {dragging && <DropZoneOverlay />}
          {attachmentsEnabled && (
            <ComposerAttachments
              attachments={attachments}
              uploadingId={uploadingId}
              progress={uploadProgress}
              onRemove={removeAttachment}
            />
          )}
          <div className="max-h-48 overflow-y-auto">
            <EditorContent editor={editor.editor} />
          </div>
          <ComposerToolbar
            editor={editor.editor}
            disabled={disabled}
            formattingOpen={formattingOpen}
            onFormattingToggle={setFormattingOpen}
            onMention={startMention}
            onAttach={
              attachmentsEnabled
                ? () => attachInputRef.current?.click()
                : undefined
            }
            onEmoji={(emoji) =>
              editor.editor?.chain().focus().insertContent(emoji).run()
            }
            sendButton={sendButton}
            sendDisabled={
              disabled ||
              (!text.trim() && attachments.length === 0 && !allowEmpty)
            }
            onSend={() => void submit()}
          />
        </div>
        {attachmentsEnabled && (
          <input
            ref={attachInputRef}
            type="file"
            multiple
            aria-label="Attach file"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        )}
      </div>
    );
  },
);
