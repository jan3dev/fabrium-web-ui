import { AppWindowIcon, ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreviewRoute, useRoomPreviews } from "@/hooks/use-previews";
import type { PreviewStatus } from "@/model/types";
import { PreviewStatusBadge } from "./preview-card";

export interface PreviewMenuItem {
  agentId: string;
  name: string;
  title: string;
  agentName: string;
  status: PreviewStatus;
  threadRoot: string;
}

/**
 * The room header's Preview button: shown while the room has a running app.
 * One app opens at once; more open a list.
 */
export function PreviewMenu({
  previews,
  onOpen,
}: {
  previews: readonly PreviewMenuItem[];
  onOpen: (preview: PreviewMenuItem) => void;
}) {
  if (previews.length === 0) return null;
  if (previews.length === 1) {
    return (
      <Button size="xs" variant="utility" data-testid="room-preview-button" onClick={() => onOpen(previews[0]!)}>
        <AppWindowIcon />
        Preview
      </Button>
    );
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="utility" data-testid="room-preview-button">
          <AppWindowIcon />
          Preview
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {previews.map((p) => (
          <DropdownMenuItem key={`${p.agentId}/${p.name}`} onSelect={() => onOpen(p)} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body2 text-text-primary">{p.title}</span>
              <span className="block truncate text-caption1 text-text-tertiary">{p.agentName}</span>
            </span>
            <PreviewStatusBadge status={p.status} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The room header's mount point for previews: polls the room's apps and opens one beside its thread. */
export function RoomPreviewMenu({
  roomId,
  agentLabel,
}: {
  roomId: string;
  /** The agent's "Name · Project" label. */
  agentLabel: (userId: string) => string;
}) {
  const previews = useRoomPreviews(roomId);
  const route = usePreviewRoute();
  return (
    <PreviewMenu
      previews={previews.map((p) => ({
        agentId: p.agent_id,
        name: p.name,
        title: p.title,
        agentName: agentLabel(p.agent_id),
        status: p.status,
        threadRoot: p.thread_root,
      }))}
      onOpen={(p) => route.open(p, p.threadRoot)}
    />
  );
}
