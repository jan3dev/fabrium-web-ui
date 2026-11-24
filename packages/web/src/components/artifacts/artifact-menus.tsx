import { useState } from "react";
import { ChevronDownIcon, EllipsisIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNow } from "@/hooks/use-now";
import { FRAME_SIZE, type FrameKind } from "@/lib/artifacts/frames";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ActorKind, ActorSummary, ArtifactVersion } from "@/model/types";

export interface FrameSize {
  width: number;
  height: number;
}

/** Artboard presets (spec §6.3). */
export const ARTBOARD_PRESETS = [
  { label: "Desktop", width: 1440, height: 900 },
  { label: "Tablet", width: 834, height: 1194 },
  { label: "Phone", width: 390, height: 844 },
] as const;

/** What the slide or artboard menu asks the panel to do with its frame. */
export type FrameAction =
  | { type: "add"; size?: FrameSize }
  | { type: "add-custom" }
  | { type: "duplicate" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "move"; by: -1 | 1 }
  | { type: "skip" }
  | { type: "rename" }
  | { type: "resize"; size: FrameSize }
  | { type: "resize-custom" }
  | { type: "delete" };

export const frameUnit = (kind: FrameKind) => (kind === "slides" ? "slide" : "artboard");

/**
 * The slide menu (spec §6.2) or artboard menu (§6.3) of one frame: a button on its card.
 * The rail also opens it on right-click and Shift+F10, through `open`.
 */
export function FrameMenu({
  kind,
  index,
  count,
  skip = false,
  open,
  onOpenChange,
  onAction,
  className,
}: {
  kind: FrameKind;
  index: number;
  count: number;
  skip?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAction: (action: FrameAction) => void;
  className?: string;
}) {
  const unit = frameUnit(kind);
  const presets = (type: "add" | "resize") => (
    <>
      {ARTBOARD_PRESETS.map((p) => (
        <DropdownMenuItem key={p.label} onSelect={() => onAction({ type, size: p })}>
          {p.label}
          <span className="ml-auto pl-4 text-caption1 text-text-tertiary tabular-nums">
            {p.width}×{p.height}
          </span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onSelect={() => onAction({ type: type === "add" ? "add-custom" : "resize-custom" })}>
        Custom…
      </DropdownMenuItem>
    </>
  );
  const move = (
    <>
      <DropdownMenuItem disabled={index === 0} onSelect={() => onAction({ type: "move", by: -1 })}>
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem disabled={index >= count - 1} onSelect={() => onAction({ type: "move", by: 1 })}>
        Move down
      </DropdownMenuItem>
    </>
  );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="small"
          tone="neutral"
          icon={<EllipsisIcon />}
          label={`${unit[0]!.toUpperCase()}${unit.slice(1)} ${index + 1} actions`}
          tooltip={false}
          className={className}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onKeyDown={(e) => e.stopPropagation()}>
        {kind === "slides" ? (
          <>
            <DropdownMenuItem onSelect={() => onAction({ type: "add" })}>Add slide after</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ type: "duplicate" })}>Duplicate slide</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ type: "rename" })}>Rename slide…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ type: "copy" })}>Copy</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ type: "paste" })}>Paste after</DropdownMenuItem>
            <DropdownMenuSeparator />
            {move}
            <DropdownMenuItem onSelect={() => onAction({ type: "skip" })}>
              {skip ? "Include slide" : "Skip slide"}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Add artboard</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>{presets("add")}</DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => onAction({ type: "rename" })}>Rename artboard…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ type: "duplicate" })}>Duplicate artboard</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Resize</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>{presets("resize")}</DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            {move}
          </>
        )}
        <DropdownMenuSeparator />
        {/* A document keeps at least one frame. */}
        <DropdownMenuItem variant="destructive" disabled={count <= 1} onSelect={() => onAction({ type: "delete" })}>
          Delete {unit}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A name to set: a slide's, an artboard's or the artifact's title. Empty is allowed when `optional`. */
export function NameDialog({
  open,
  title,
  value,
  optional = false,
  maxLength,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  value: string;
  optional?: boolean;
  maxLength: number;
  onSubmit: (name: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(value);
  const ready = optional || name.trim() !== "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={(e) => e.stopPropagation()}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            onSubmit(name.trim());
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="artifact-name">Name</Label>
            <Input
              id="artifact-name"
              autoFocus
              value={name}
              maxLength={maxLength}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!ready}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A custom artboard size in px, within the frame bounds. */
export function SizeDialog({
  open,
  title,
  value,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  value: FrameSize;
  onSubmit: (size: FrameSize) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [size, setSize] = useState({ width: String(value.width), height: String(value.height) });
  const valid = (v: string) => /^\d+$/.test(v) && +v >= FRAME_SIZE.min && +v <= FRAME_SIZE.max;
  const ready = valid(size.width) && valid(size.height);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={(e) => e.stopPropagation()}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            onSubmit({ width: +size.width, height: +size.height });
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {(["width", "height"] as const).map((k) => (
              <div key={k} className="grid gap-2">
                <Label htmlFor={`artboard-${k}`}>{k === "width" ? "Width (px)" : "Height (px)"}</Label>
                <Input
                  id={`artboard-${k}`}
                  inputMode="numeric"
                  value={size[k]}
                  aria-invalid={!valid(size[k])}
                  onChange={(e) => setSize((s) => ({ ...s, [k]: e.target.value.trim() }))}
                />
              </div>
            ))}
          </div>
          <p className="text-caption1 text-text-tertiary">
            From {FRAME_SIZE.min} to {FRAME_SIZE.max} px.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!ready}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DOT: Record<ActorKind, string> = {
  agent: "bg-actor-agent",
  human: "bg-actor-human",
  system: "bg-actor-system",
};

/** The author's actor marker: a dot in the actor color (agent, human, system). */
export function ActorDot({ kind, className }: { kind: ActorKind; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[kind], className)} />;
}

/** Dot, name and, for agents and system users, a badge. */
function ActorLabel({ actor, className }: { actor: ActorSummary; className?: string }) {
  return (
    <>
      <ActorDot kind={actor.kind} />
      <span className={cn("truncate", className)}>{actor.displayName}</span>
      {actor.kind === "human" ? null : (
        <Badge tone={actor.kind} className="px-1.5 py-0 text-caption2">
          {actor.kind}
        </Badge>
      )}
    </>
  );
}

/** The artifact's title with its menu (spec §6.1): Rename, Duplicate and, on an older version, Restore. */
export function ArtifactTitleMenu({
  title,
  older,
  onRename,
  onDuplicate,
  onRestore,
}: {
  title: string;
  /** The panel shows an older version: offer Restore. */
  older: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onRestore: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      {/* The button inside the heading, so the heading keeps its role and its name. */}
      <h2 className="min-w-0 font-heading text-subtitle font-semibold">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="artifact-title-menu"
            className="flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-utility text-left hover:text-text-secondary"
          >
            <span className="truncate">{title}</span>
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-text-tertiary" />
          </button>
        </DropdownMenuTrigger>
      </h2>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
        {older ? <DropdownMenuItem onSelect={onRestore}>Restore this version</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The version list (spec §6.1 "v7 ▾"): newest first, each with its summary and its
 * author with the actor marker. A version people saved into says who edited it last and
 * when, with that author's marker, so a user's edit never reads as the agent's.
 */
export function VersionMenu({
  versions,
  current,
  onSelect,
}: {
  /** Oldest first, as the panel holds them. */
  versions: readonly Pick<ArtifactVersion, "eventId" | "version" | "summary" | "author" | "edited">[];
  current: string;
  onSelect: (eventId: string) => void;
}) {
  const shown = versions.find((v) => v.eventId === current);
  const latest = versions.at(-1);
  const now = useNow();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="utility" data-testid="artifact-versions" className="tabular-nums">
          v{shown?.version} of {latest?.version}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={current} onValueChange={onSelect}>
          {[...versions].reverse().map((v) => (
            <DropdownMenuRadioItem key={v.eventId} value={v.eventId} className="items-start">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-medium tabular-nums">v{v.version}</span>
                  <ActorLabel actor={v.author} className="text-caption1 text-text-secondary" />
                </span>
                <span className={cn("truncate text-caption1", v.summary ? "text-text-secondary" : "text-text-tertiary")}>
                  {v.summary ?? (v.version === 1 ? "Created" : "No summary")}
                </span>
                {v.edited ? (
                  <span
                    className="flex min-w-0 items-center gap-1.5 text-caption1 text-text-secondary"
                    title={formatAbsoluteTime(v.edited.at)}
                  >
                    <span className="shrink-0">Edited by</span>
                    <ActorLabel actor={v.edited.by} />
                    <span className="shrink-0 text-text-tertiary">· {formatRelativeTime(v.edited.at, now)}</span>
                  </span>
                ) : null}
                {v.edited?.summary ? (
                  <span className="truncate text-caption1 text-text-tertiary">
                    {v.edited.saves > 1 ? `Last of ${v.edited.saves} edits: ` : ""}
                    {v.edited.summary}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
