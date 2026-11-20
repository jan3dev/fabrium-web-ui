import { Fragment, useState } from "react";
import {
  AlignBottomIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  ChevronDownIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
  ImageIcon,
  LayersIcon,
  LineIcon,
  NoteIcon,
  PlusIcon,
  SelectIcon,
  ShapesIcon,
  TableIcon,
  TextIcon,
  VideoIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CanvasAction } from "@/hooks/use-canvas-editor";
import type { Template } from "@/lib/artifacts/canvas";

const SHAPES: { template: Template; label: string; keys: string }[] = [
  { template: "rect", label: "Rectangle", keys: "R" },
  { template: "rounded", label: "Rounded rectangle", keys: "⇧R" },
  { template: "oval", label: "Oval", keys: "O" },
  { template: "diamond", label: "Diamond", keys: "D" },
];
const LINES: { template: Template; label: string; keys: string }[] = [
  { template: "line", label: "Line", keys: "L" },
  { template: "arrow", label: "Arrow", keys: "⇧L" },
];

/** Arrange menu entries; `min` is the selection size they need. */
const ARRANGE: ({ action: CanvasAction; label: string; keys: string; min: number } | null)[] = [
  { action: "duplicate", label: "Duplicate", keys: "⌘D", min: 1 },
  { action: "copy", label: "Copy", keys: "⌘C", min: 1 },
  { action: "cut", label: "Cut", keys: "⌘X", min: 1 },
  { action: "paste", label: "Paste", keys: "⌘V", min: 0 },
  { action: "delete", label: "Delete", keys: "⌫", min: 1 },
  null,
  { action: "group", label: "Group", keys: "⌘G", min: 1 },
  { action: "ungroup", label: "Ungroup", keys: "⌘⇧G", min: 1 },
  { action: "front", label: "Bring to front", keys: "]", min: 1 },
  { action: "back", label: "Send to back", keys: "[", min: 1 },
  { action: "flipH", label: "Flip horizontal", keys: "⇧H", min: 1 },
  { action: "flipV", label: "Flip vertical", keys: "⇧V", min: 1 },
  null,
  { action: "select-all", label: "Select all", keys: "⌘A", min: 0 },
];

/** Align and distribute: one layer aligns to the frame, several to each other. */
const ALIGN: { action: CanvasAction; label: string; icon: React.ReactNode; min: number }[] = [
  { action: "align-left", label: "Align left", icon: <AlignLeftIcon />, min: 1 },
  { action: "align-center", label: "Align center", icon: <AlignCenterIcon />, min: 1 },
  { action: "align-right", label: "Align right", icon: <AlignRightIcon />, min: 1 },
  { action: "align-top", label: "Align top", icon: <AlignTopIcon />, min: 1 },
  { action: "align-middle", label: "Align middle", icon: <AlignMiddleIcon />, min: 1 },
  { action: "align-bottom", label: "Align bottom", icon: <AlignBottomIcon />, min: 1 },
  { action: "distribute-h", label: "Distribute horizontally", icon: <DistributeHorizontalIcon />, min: 3 },
  { action: "distribute-v", label: "Distribute vertically", icon: <DistributeVerticalIcon />, min: 3 },
];

function InsertMenu({
  label,
  icon,
  items,
  onInsert,
}: {
  label: string;
  icon: React.ReactNode;
  items: typeof SHAPES;
  onInsert: (template: Template) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost" aria-label={label}>
          {icon}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((s) => (
          <DropdownMenuItem key={s.template} onSelect={() => onInsert(s.template)}>
            {s.label}
            <DropdownMenuShortcut>{s.keys}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableInsert({ onInsert }: { onInsert: (size: { rows: number; cols: number }) => void }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState({ rows: 3, cols: 3 });
  const clamp = (n: number) => Math.min(20, Math.max(1, Math.round(n) || 1));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton size="small" icon={<TableIcon />} label="Table" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56">
        <form
          aria-label="Insert table"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onInsert(size);
            setOpen(false);
          }}
        >
          <div className="flex gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="canvas-table-rows">Rows</Label>
              <Input
                id="canvas-table-rows"
                type="number"
                min={1}
                max={20}
                value={size.rows}
                onChange={(e) => setSize((s) => ({ ...s, rows: clamp(e.target.valueAsNumber) }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="canvas-table-cols">Columns</Label>
              <Input
                id="canvas-table-cols"
                type="number"
                min={1}
                max={20}
                value={size.cols}
                onChange={(e) => setSize((s) => ({ ...s, cols: clamp(e.target.valueAsNumber) }))}
              />
            </div>
          </div>
          <Button type="submit" size="xs">
            Insert table
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The insert tools as one menu, for a narrow stage. Table inserts 3 × 3 here. */
function InsertAllMenu({
  onInsert,
  onUpload,
}: {
  onInsert: (template: Template, size?: { rows: number; cols: number }) => void;
  onUpload: (kind: "image" | "video") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost" aria-label="Insert">
          <PlusIcon />
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onInsert("text")}>
          Text<DropdownMenuShortcut>T</DropdownMenuShortcut>
        </DropdownMenuItem>
        {[...SHAPES, ...LINES].map((s) => (
          <DropdownMenuItem key={s.template} onSelect={() => onInsert(s.template)}>
            {s.label}
            <DropdownMenuShortcut>{s.keys}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onUpload("image")}>
          Image
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onUpload("video")}>
          Video
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsert("table", { rows: 3, cols: 3 })}>Table</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInsert("note")}>Note</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The canvas tools (spec §6.1, §6.4): Select, the insert tools, the Arrange menu and the Align
 * menu. Insert places a free layer at the centre of the open slide or artboard. Image and
 * Video upload a file (spec §5.4) through `onUpload`.
 *
 * It collapses by the width of its `@container` (the stage): below 28rem the insert tools are
 * one menu; narrower still, it scrolls.
 */
export function CanvasToolbar({
  selected,
  onInsert,
  onAction,
  onUpload,
}: {
  /** How many layers are selected. */
  selected: number;
  onInsert: (template: Template, size?: { rows: number; cols: number }) => void;
  onAction: (action: CanvasAction) => void;
  /** Image or video upload. */
  onUpload: (kind: "image" | "video") => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      data-testid="canvas-toolbar"
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-card border border-border bg-surface-primary p-1 shadow-surface"
    >
      <IconButton
        size="small"
        icon={<SelectIcon />}
        label="Select"
        aria-pressed
        tone="brand"
        onClick={() => onAction("select-none")}
      />
      <div className="@md:hidden">
        <InsertAllMenu onInsert={onInsert} onUpload={onUpload} />
      </div>
      <div className="hidden items-center gap-0.5 @md:flex">
        <IconButton size="small" icon={<TextIcon />} label="Text" onClick={() => onInsert("text")} />
        <InsertMenu label="Shape" icon={<ShapesIcon />} items={SHAPES} onInsert={onInsert} />
        <InsertMenu label="Line" icon={<LineIcon />} items={LINES} onInsert={onInsert} />
        <IconButton
          size="small"
          icon={<ImageIcon />}
          label="Image"
          onClick={() => onUpload("image")}
        />
        <IconButton
          size="small"
          icon={<VideoIcon />}
          label="Video"
          onClick={() => onUpload("video")}
        />
        <TableInsert onInsert={(size) => onInsert("table", size)} />
        <IconButton size="small" icon={<NoteIcon />} label="Note" onClick={() => onInsert("note")} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost" aria-label="Arrange">
            <LayersIcon />
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
          {ARRANGE.map((item, i) =>
            item ? (
              <DropdownMenuItem key={item.action} disabled={selected < item.min} onSelect={() => onAction(item.action)}>
                {item.label}
                <DropdownMenuShortcut>{item.keys}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSeparator key={i} />
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="ghost" aria-label="Align" disabled={selected === 0}>
            <AlignLeftIcon />
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ALIGN.map((a) => (
            <Fragment key={a.action}>
              {a.action === "distribute-h" ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem disabled={selected < a.min} onSelect={() => onAction(a.action)}>
                {a.icon}
                {a.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
