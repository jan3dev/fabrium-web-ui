// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageActionBar.tsx. Modified.
import * as React from "react";

import {
  CommentIcon,
  CopyIcon,
  EllipsisIcon,
  ForwardIcon,
  LinkIcon,
  PencilIcon,
  QuoteIcon,
  SmilePlusIcon,
  TrashIcon,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { ReactionPicker } from "./reaction-picker";

const QUICK_REACTIONS = ["👍", "✅", "👀"];

/** Everything the bar can do. A missing handler hides its control. */
export interface MessageActionHandlers {
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onCopyLink?: () => void;
  onCopyText?: () => void;
  onQuote?: () => void;
  onShare?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** Hover/focus toolbar over a message row. */
export function MessageActionBar({
  onReact,
  onReply,
  onCopyLink,
  onCopyText,
  onQuote,
  onShare,
  onEdit,
  onDelete,
}: MessageActionHandlers) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // Start editing only once the menu has closed, or its focus restore steals the editor's focus.
  const pendingEditRef = React.useRef(false);

  return (
    <div
      className={cn(
        "transition-opacity duration-(--duration-fast)",
        "sm:pointer-events-none sm:opacity-0",
        "sm:group-hover/message:pointer-events-auto sm:group-hover/message:opacity-100",
        "sm:group-focus-within/message:pointer-events-auto sm:group-focus-within/message:opacity-100",
        (pickerOpen || menuOpen) && "sm:pointer-events-auto sm:opacity-100",
      )}
      data-testid="message-action-bar"
    >
      <div className="flex items-center gap-0.5 rounded-pill border border-surface-border-primary bg-surface-primary p-1 shadow-button">
        {onReact ? (
          <>
            <div className="hidden items-center gap-0.5 sm:flex">
              {QUICK_REACTIONS.map((emoji) => (
                <Tooltip key={emoji}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`React with ${emoji}`}
                      onClick={() => onReact(emoji)}
                      className="flex size-8 items-center justify-center rounded-pill text-body1 leading-none hover:bg-surface-secondary"
                    >
                      <span aria-hidden>{emoji}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>React with {emoji}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <ReactionPicker
              onPick={onReact}
              onOpenChange={setPickerOpen}
              trigger={<IconButton label="add reaction" icon={<SmilePlusIcon />} className="rounded-pill" />}
            />
            <div aria-hidden className="mx-0.5 hidden h-4 w-px bg-surface-border-primary sm:block" />
          </>
        ) : null}
        {onReply ? (
          <IconButton label="Reply in thread" icon={<CommentIcon />} className="rounded-pill" onClick={onReply} />
        ) : null}
        {onCopyLink ? (
          <IconButton label="Copy link" icon={<LinkIcon />} className="rounded-pill" onClick={onCopyLink} />
        ) : null}
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" icon={<EllipsisIcon />} className="rounded-pill" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            sideOffset={6}
            onCloseAutoFocus={(event) => {
              if (!pendingEditRef.current) return;
              event.preventDefault();
              pendingEditRef.current = false;
              onEdit?.();
            }}
          >
            {onEdit ? (
              <DropdownMenuItem onSelect={() => (pendingEditRef.current = true)}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
            ) : null}
            {onCopyText ? (
              <DropdownMenuItem onSelect={onCopyText}>
                <CopyIcon />
                Copy text
              </DropdownMenuItem>
            ) : null}
            {onQuote ? (
              <DropdownMenuItem onSelect={onQuote}>
                <QuoteIcon />
                Quote
              </DropdownMenuItem>
            ) : null}
            {onShare ? (
              <DropdownMenuItem onSelect={onShare}>
                <ForwardIcon />
                Share
              </DropdownMenuItem>
            ) : null}
            {onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <TrashIcon />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {onDelete ? (
        <DeleteConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} onConfirm={onDelete} />
      ) : null}
    </div>
  );
}
