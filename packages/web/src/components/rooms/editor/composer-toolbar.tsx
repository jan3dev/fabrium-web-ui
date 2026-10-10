// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageComposerToolbar.tsx. Modified.
import type { Editor } from "@tiptap/react";

import {
  ALargeSmallIcon,
  AtSignIcon,
  CloseIcon,
  PaperclipIcon,
  SendIcon,
  SmileIcon,
} from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { ReactionPicker } from "@/components/timeline/reaction-picker";
import { FormattingToolbar } from "./formatting-toolbar";
import { SelectionFormattingTray } from "./selection-formatting-tray";

/**
 * The row under the editor. Passive: mention, attach, emoji, formatting
 * toggle. With formatting open, the formatting buttons take the row. Send (and
 * any extra action, like Stop) sits on the right either way.
 */
export function ComposerToolbar({
  editor,
  disabled,
  formattingOpen,
  onFormattingToggle,
  onMention,
  onAttach,
  onEmoji,
  sendButton = true,
  sendDisabled,
  onSend,
}: {
  editor: Editor | null;
  disabled: boolean;
  formattingOpen: boolean;
  onFormattingToggle: (open: boolean) => void;
  onMention: () => void;
  /** Absent when attachments are off. */
  onAttach?: () => void;
  onEmoji: (emoji: string) => void;
  sendButton?: boolean;
  sendDisabled: boolean;
  onSend: () => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2">
      <SelectionFormattingTray editor={editor} disabled={disabled} />
      {formattingOpen ? (
        <div className="-ml-1 flex min-w-0 flex-1 items-center gap-0.5">
          <IconButton
            icon={<CloseIcon />}
            label="Close formatting"
            size="small"
            disabled={disabled}
            onClick={() => onFormattingToggle(false)}
          />
          <div className="mx-1 h-5 w-px shrink-0 bg-border" />
          <div className="min-w-0 flex-1 overflow-x-auto">
            <FormattingToolbar editor={editor} disabled={disabled} />
          </div>
        </div>
      ) : (
        <div className="-ml-1 flex items-center gap-0.5">
          <IconButton
            icon={<AtSignIcon />}
            label="Mention someone"
            size="small"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onMention}
          />
          {onAttach ? (
            <IconButton
              icon={<PaperclipIcon />}
              label="Attach file"
              size="small"
              disabled={disabled}
              onClick={onAttach}
            />
          ) : null}
          <ReactionPicker
            onPick={onEmoji}
            trigger={
              <IconButton
                icon={<SmileIcon />}
                label="Emoji"
                size="small"
                disabled={disabled}
                tooltip={false}
              />
            }
          />
          <IconButton
            icon={<ALargeSmallIcon />}
            label="Formatting"
            size="small"
            disabled={disabled}
            aria-pressed={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFormattingToggle(true)}
          />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {sendButton ? (
          <IconButton
            icon={<SendIcon />}
            label="Send message"
            tone="primary"
            size="small"
            tooltip={false}
            disabled={sendDisabled}
            onClick={onSend}
          />
        ) : null}
      </div>
    </div>
  );
}
