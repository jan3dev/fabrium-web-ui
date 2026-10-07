// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/channels/ui/EphemeralChannelBadge.tsx. Modified.
import { ArchiveIcon, ShieldCheckIcon } from "@/components/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const LABELS = {
  archived: "Archived: read only",
  encrypted: "End-to-end encrypted",
} as const;

function StatusIcon({ status }: { status: keyof typeof LABELS }) {
  const Icon = status === "archived" ? ArchiveIcon : ShieldCheckIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={LABELS[status]}
          className="flex size-5 items-center justify-center"
        >
          <Icon className="size-4 shrink-0 text-text-tertiary" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}

/** Header markers for an archived (tombstoned) room and an encrypted room. */
export function RoomStatusBadge({
  archived,
  encrypted,
}: {
  archived: boolean;
  encrypted: boolean;
}) {
  return (
    <>
      {archived ? <StatusIcon status="archived" /> : null}
      {encrypted ? <StatusIcon status="encrypted" /> : null}
    </>
  );
}
