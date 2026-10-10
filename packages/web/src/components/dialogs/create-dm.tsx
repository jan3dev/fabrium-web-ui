import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { MatrixClientPeg } from "../../client/peg";
import { createDirectRoom } from "../../lib/matrix/direct-messages";
import { useSpaceMembers } from "../../hooks/use-space-members";
import { useWorkforce } from "../../hooks/use-workforce";
import { UserResultRow } from "./user-result-row";

interface CreateDmDialogProps {
  open: boolean;
  spaceId: string;
  onOpenChange: (open: boolean) => void;
}

export function CreateDmDialog({ open, spaceId, onOpenChange }: CreateDmDialogProps) {
  const members = useSpaceMembers(spaceId);
  const { ready, isAgent } = useWorkforce(spaceId);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const me = MatrixClientPeg.safeGet()?.getUserId();
  const candidates = useMemo(() => {
    return members
      .filter((m) => m.userId !== me)
      .filter((m) => !ready || !isAgent(m.userId));
  }, [members, me, ready, isAgent]);

  const toggle = (userId: string) => {
    setSelected((cur) => (cur.includes(userId) ? cur.filter((u) => u !== userId) : [...cur, userId]));
  };

  const onCreate = async () => {
    if (!selected.length) return;
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    setSubmitting(true);
    try {
      const roomId = await createDirectRoom(client, selected);
      onOpenChange(false);
      setSelected([]);
      navigate(`/room/${roomId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a DM</DialogTitle>
          <DialogDescription>
            DMs are private to the people you invite. Agents are managed via <code>zooid.yaml</code>.
          </DialogDescription>
        </DialogHeader>
        {!ready && (
          <Alert tone="warning" role="status" className="p-3 text-caption1">
            Agent list unavailable — the picker may include agents until the workforce roster
            publishes.
          </Alert>
        )}
        <Command>
          <CommandInput placeholder="Search humans…" />
          <CommandList>
            <CommandEmpty>No humans found.</CommandEmpty>
            <CommandGroup>
              {candidates.map((m) => (
                <CommandItem
                  key={m.userId}
                  value={`${m.name ?? m.userId} ${m.userId}`}
                  onSelect={() => toggle(m.userId)}
                  data-selected={selected.includes(m.userId) || undefined}
                >
                  <UserResultRow
                    userId={m.userId}
                    name={m.name ?? m.userId}
                    selected={selected.includes(m.userId)}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selected.length || submitting} onClick={onCreate}>
            Start DM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
