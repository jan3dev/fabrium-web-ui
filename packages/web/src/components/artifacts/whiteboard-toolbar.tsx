import {
  AgentActionsIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ConnectIcon,
  DiamondIcon,
  FillIcon,
  GroupIcon,
  ImageIcon,
  LineIcon,
  NoteIcon,
  OvalIcon,
  RectangleIcon,
  ReverseIcon,
  SectionIcon,
  TextIcon,
  TrashIcon,
  VideoIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import {
  type Arrow,
  BOARD_COLORS,
  type BoardColor,
  type BoardEdge,
  type BoardRequest,
  type EdgePatch,
  type LineStyle,
  type NodeType,
  type ShapeKind,
} from "@/lib/artifacts/whiteboard";
import { FrameControls } from "./frame-rail";

export type BoardTool = { type: Exclude<NodeType, "image" | "video" | "shape"> } | { type: "shape"; shape: ShapeKind };

const ADD: { tool: BoardTool; label: string; icon: React.ReactNode }[] = [
  { tool: { type: "note" }, label: "Note", icon: <NoteIcon /> },
  { tool: { type: "text" }, label: "Text", icon: <TextIcon /> },
  { tool: { type: "shape", shape: "rectangle" }, label: "Rectangle", icon: <RectangleIcon /> },
  { tool: { type: "shape", shape: "oval" }, label: "Oval", icon: <OvalIcon /> },
  { tool: { type: "shape", shape: "diamond" }, label: "Diamond", icon: <DiamondIcon /> },
  { tool: { type: "section" }, label: "Section", icon: <SectionIcon /> },
];

const REQUESTS: { request: BoardRequest; label: string }[] = [
  { request: "reorganize", label: "Reorganize" },
  { request: "gaps", label: "Find the gaps" },
];
const CONVERT: { request: BoardRequest; label: string }[] = [
  { request: "deck", label: "Turn into a deck" },
  { request: "document", label: "Turn into a document" },
];

const ARROW_OPTIONS: { value: Arrow; label: string }[] = [
  { value: "none", label: "No arrowheads" },
  { value: "end", label: "Arrow at the end" },
  { value: "both", label: "Arrows at both ends" },
];
const STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const colorName = (c: BoardColor) => c[0]!.toUpperCase() + c.slice(1);

/**
 * The whiteboard's tools (spec §6.10): add a node at the center of the view, the selection's
 * color, connect, group and delete, the zoom, and the agent's actions. A selected connection adds
 * its arrowheads, line style, direction and label. Editing tools show only with `onAdd`; the
 * agent's actions only with `onRequest`.
 */
export function WhiteboardToolbar({
  selected,
  edge,
  canDelete,
  onAdd,
  onUpload,
  onColor,
  onEdge,
  onReverse,
  onLabel,
  onConnect,
  onGroup,
  onDelete,
  zoom,
  scale,
  onZoom,
  onRequest,
  onArea,
}: {
  /** How many nodes are selected. */
  selected: number;
  /** The selected connection, or null. */
  edge: BoardEdge | null;
  /** A node or a connection is selected. */
  canDelete: boolean;
  onAdd?: (tool: BoardTool) => void;
  onUpload?: (kind: "image" | "video") => void;
  /** The selected nodes' color, or the selected connection's. */
  onColor: (color: BoardColor | null) => void;
  onEdge: (patch: EdgePatch) => void;
  onReverse: () => void;
  onLabel: () => void;
  onConnect: () => void;
  onGroup: () => void;
  onDelete: () => void;
  /** null fits the board to the view. */
  zoom: number | null;
  scale: number;
  onZoom: (zoom: number | null) => void;
  onRequest?: (request: BoardRequest) => void;
  /** Arms "Ask about this area": the next drag on the board picks the nodes. */
  onArea?: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      data-testid="whiteboard-toolbar"
      // Keys here never reach the board (arrows, Delete).
      onKeyDown={(e) => e.stopPropagation()}
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-card border border-border bg-surface-primary p-1 shadow-surface"
    >
      {onAdd ? (
        <>
          {ADD.map((a) => (
            <IconButton key={a.label} size="small" icon={a.icon} label={`Add ${a.label.toLowerCase()}`} onClick={() => onAdd(a.tool)} />
          ))}
          {onUpload ? (
            <>
              <IconButton size="small" icon={<ImageIcon />} label="Add image" onClick={() => onUpload("image")} />
              <IconButton size="small" icon={<VideoIcon />} label="Add video" onClick={() => onUpload("video")} />
            </>
          ) : null}
          <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" aria-label="Color" disabled={selected === 0 && !edge}>
                <FillIcon />
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {BOARD_COLORS.map((c) => (
                <DropdownMenuItem key={c} onSelect={() => onColor(c)}>
                  <span aria-hidden data-board-color={c} className="size-3 rounded-full border border-board-hue bg-board-fill" />
                  {colorName(c)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onColor(null)}>Default</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {edge ? (
            <>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="ghost" aria-label="Arrowheads">
                    <ArrowRightIcon />
                    <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup value={edge.arrow ?? "end"} onValueChange={(v) => onEdge({ arrow: v as Arrow })}>
                    {ARROW_OPTIONS.map((o) => (
                      <DropdownMenuRadioItem key={o.value} value={o.value}>
                        {o.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="ghost" aria-label="Line style">
                    <LineIcon />
                    <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup value={edge.style ?? "solid"} onValueChange={(v) => onEdge({ style: v as LineStyle })}>
                    {STYLE_OPTIONS.map((o) => (
                      <DropdownMenuRadioItem key={o.value} value={o.value}>
                        {o.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <IconButton size="small" icon={<ReverseIcon />} label="Reverse direction" onClick={onReverse} />
              <IconButton size="small" icon={<TextIcon />} label="Edit label" onClick={onLabel} />
            </>
          ) : null}
          <IconButton size="small" icon={<ConnectIcon />} label="Connect the two selected" disabled={selected !== 2} onClick={onConnect} />
          <IconButton size="small" icon={<GroupIcon />} label="Group into a section" disabled={selected === 0} onClick={onGroup} />
          <IconButton size="small" icon={<TrashIcon />} label="Delete" tone="danger" disabled={!canDelete} onClick={onDelete} />
          <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
        </>
      ) : null}
      <FrameControls zoom={zoom} scale={scale} onZoom={onZoom} />
      {onRequest ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost">
              <AgentActionsIcon />
              Ask agent
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {REQUESTS.map((r) => (
              <DropdownMenuItem key={r.request} onSelect={() => onRequest(r.request)}>
                {r.label}
              </DropdownMenuItem>
            ))}
            {onArea ? <DropdownMenuItem onSelect={onArea}>Ask about this area</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            {CONVERT.map((r) => (
              <DropdownMenuItem key={r.request} onSelect={() => onRequest(r.request)}>
                {r.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
