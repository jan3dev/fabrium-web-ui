// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/channels/ui/AddMemberSearchResultRow.tsx. Modified.
import { CheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";

/**
 * One person in a user picker: avatar, name, Matrix ID, an Agent chip, and a
 * check once picked. Render it inside the picker's list item, which owns
 * selection and keyboard handling.
 */
export function UserResultRow({
  userId,
  name,
  agent = false,
  selected = false,
}: {
  userId: string;
  name: string;
  agent?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-3"
      data-testid={`user-result-${userId}`}
    >
      <UserAvatar userId={userId} agent={agent} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body2 font-medium">{name}</span>
          {agent ? (
            <Badge tone="agent" className="px-1.5 py-0 text-caption2">
              Agent
            </Badge>
          ) : null}
        </div>
        <span className="block truncate text-caption1 text-text-tertiary">
          {userId}
        </span>
      </div>
      {selected ? (
        <CheckIcon
          aria-label="Selected"
          className="size-4 shrink-0 text-accent-brand"
        />
      ) : null}
    </div>
  );
}
