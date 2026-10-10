// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/SidebarProfileCard.tsx. Modified.
import { SettingsIcon, SignOutIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { MatrixClientPeg } from "../../../client/peg";
import { useMatrixClient } from "../../../hooks/use-matrix-client";
import { usePresence } from "../../../hooks/use-presence";
import { useUserName } from "../../../hooks/use-user-name";

/** Sidebar footer: who you are, where you are, and the settings / log-out menu. */
export function SidebarProfileCard({
  workspaceName,
  onOpenSettings,
}: {
  workspaceName: string;
  onOpenSettings: () => void;
}) {
  const userId = useMatrixClient().getUserId() ?? "";
  const name = useUserName(userId);
  const { presence } = usePresence(userId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-card px-2 py-2 text-left outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent"
        >
          <UserAvatar
            userId={userId}
            size="sm"
            presence={presence}
            className="size-8 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body2 font-semibold leading-tight">
              {name}
            </span>
            <span className="mt-0.5 block truncate text-caption1 text-sidebar-foreground/70">
              {workspaceName}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-caption1 font-normal text-muted-foreground">
            {userId}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void MatrixClientPeg.logout()}>
          <SignOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
