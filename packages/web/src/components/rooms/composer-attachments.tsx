// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/ComposerAttachments.tsx. Modified.
import { useEffect, useState } from "react";
import { CloseIcon, FileTextIcon, ImageIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { MAX_UPLOAD_BYTES } from "../../hooks/use-media-upload";

/** Matches the per-turn pending-media cap the daemon enforces (ZOD057). */
export const MAX_ATTACHMENTS = 8;

export interface StagedAttachment {
  /** Stable across re-renders so React keys and preview URLs don't churn. */
  id: string;
  file: File;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `att-${seq}`;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Names the browser invents for a screenshot on the clipboard. */
const GENERIC_CLIPBOARD_NAME = /^(image|screenshot)?\.?(png|jpe?g|gif|webp|avif)?$/i;

/**
 * A screenshot pasted from the clipboard arrives named `image.png` — useless as
 * a timeline body, and every paste collides with the last one. Give those a
 * sortable name. A real file copied from the file manager keeps its own name.
 */
export function nameClipboardFile(file: File, now = new Date()): File {
  if (file.name && !GENERIC_CLIPBOARD_NAME.test(file.name)) return file;
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".png";
  const stamp =
    `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}` +
    `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return new File([file], `pasted-${stamp}${ext}`, { type: file.type });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface StageResult {
  staged: StagedAttachment[];
  error: string | null;
}

/**
 * Applies the two staging rules — per-file size cap and the total cap — to a
 * batch of incoming files. Accepts what fits rather than rejecting the whole
 * batch, so dropping ten files still stages the first eight.
 */
export function stageFiles(current: StagedAttachment[], incoming: File[]): StageResult {
  const tooBig = incoming.filter((f) => f.size > MAX_UPLOAD_BYTES);
  const withinSize = incoming.filter((f) => f.size <= MAX_UPLOAD_BYTES);
  const room = Math.max(0, MAX_ATTACHMENTS - current.length);
  const accepted = withinSize.slice(0, room);
  const overflow = withinSize.length - accepted.length;

  // Each problem is a standalone sentence: the size one leads with a filename,
  // which must not be case-mangled to make a sentence out of the whole string.
  const problems: string[] = [];
  if (tooBig.length === 1) {
    problems.push(`\u201C${tooBig[0].name}\u201D is over the 0.5 MB limit.`);
  } else if (tooBig.length > 1) {
    problems.push(`${tooBig.length} files are over the 0.5 MB limit.`);
  }
  if (overflow > 0) {
    problems.push(`No more than ${MAX_ATTACHMENTS} attachments can be sent at once.`);
  }

  return {
    staged: [...current, ...accepted.map((file) => ({ id: nextId(), file }))],
    error: problems.length > 0 ? problems.join(" ") : null,
  };
}

/** Object URL for image files, revoked when the file leaves the tray. */
function useObjectUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * Remove badges stay invisible until hover, but `opacity-0` (not `hidden`)
 * keeps them in the tab order so keyboard users can still reach them.
 */
const REVEAL =
  "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100";

function AttachmentTile({
  attachment,
  progress,
  onRemove,
}: {
  attachment: StagedAttachment;
  progress?: number;
  onRemove: (id: string) => void;
}) {
  const { id, file } = attachment;
  const previewUrl = useObjectUrl(file);
  const uploading = progress !== undefined && progress > 0 && progress < 1;

  return (
    <li className="group relative" title={`${file.name} · ${formatBytes(file.size)}`}>
      {previewUrl ? (
        <div className="size-[55px] overflow-hidden rounded-card border border-border bg-surface-secondary">
          <img src={previewUrl} alt={file.name} className="size-full object-cover" />
        </div>
      ) : (
        <div className="flex h-[55px] max-w-48 items-center gap-2 rounded-card border border-border bg-surface-secondary px-3">
          <FileTextIcon className="size-5 shrink-0 text-text-tertiary" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-caption1 text-text-primary">{file.name}</span>
            <span className="text-caption2 text-text-tertiary">{formatBytes(file.size)}</span>
          </span>
        </div>
      )}
      {uploading ? (
        <div className="absolute inset-x-2 bottom-1.5 h-1 overflow-hidden rounded-pill bg-surface-tertiary">
          <div
            role="progressbar"
            aria-label={`Uploading ${file.name}`}
            aria-valuenow={Math.round(progress * 100)}
            className="h-full bg-accent-brand transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={() => onRemove(id)}
        className={cn(
          "absolute -top-1 -right-1 z-10 flex size-4 items-center justify-center rounded-full bg-surface-inverse text-text-inverse",
          REVEAL,
        )}
      >
        <CloseIcon className="size-2.5" />
      </button>
    </li>
  );
}

export interface ComposerAttachmentsProps {
  attachments: StagedAttachment[];
  /** The attachment uploading now, and how far along (0..1). */
  uploadingId?: string | null;
  progress?: number;
  onRemove: (id: string) => void;
}

/** Thumbnails of the files staged in the composer, each removable. */
export function ComposerAttachments({
  attachments,
  uploadingId,
  progress,
  onRemove,
}: ComposerAttachmentsProps) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Staged attachments" className="mb-2 flex flex-wrap items-center gap-2">
      {attachments.map((a) => (
        <AttachmentTile
          key={a.id}
          attachment={a}
          progress={a.id === uploadingId ? progress : undefined}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

/** Dashed overlay while files are dragged over the composer. */
export function DropZoneOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-card border-2 border-dashed border-accent-brand bg-accent-brand-transparent">
      <span className="flex items-center gap-2 rounded-pill bg-surface-inverse px-4 py-2 text-body2 font-semibold text-text-inverse">
        <ImageIcon className="size-4" />
        Drop to attach · up to {MAX_ATTACHMENTS} files, 0.5 MB each
      </span>
    </div>
  );
}
