// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/CreateChannelDialog.tsx. Modified.
// Also derived from desktop/src/features/sidebar/ui/CreateChannelFormFields.tsx.
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockIcon, UsersIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { MatrixClientPeg } from "../../client/peg";

type Privacy = "space" | "invite";

const PRIVACY_OPTIONS = [
  { value: "space", label: "Workspace", Icon: UsersIcon },
  { value: "invite", label: "Invite only", Icon: LockIcon },
] as const;

const LABEL = "text-body2 font-medium text-text-primary";
const OPTIONAL = "ml-1 text-caption1 font-normal text-text-tertiary";

interface CreateRoomDialogProps {
  open: boolean;
  spaceId: string;
  onOpenChange: (open: boolean) => void;
}

export function CreateRoomDialog({
  open,
  spaceId,
  onOpenChange,
}: CreateRoomDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("space");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const reset = () => {
    setName("");
    setTopic("");
    setPrivacy("space");
    setSubmitting(false);
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const client = MatrixClientPeg.safeGet();
    if (!client) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const serverName = client.getUserId()?.split(":")[1] ?? "";
      const initialState: Record<string, unknown>[] = [
        {
          type: "m.space.parent",
          state_key: spaceId,
          content: { via: [serverName], canonical: true },
        },
      ];
      if (privacy === "space") {
        // Restricted-to-space: any member of this space can join. Without this,
        // the room would default to invite-only (private_chat).
        initialState.push({
          type: "m.room.join_rules",
          state_key: "",
          content: {
            join_rule: "restricted",
            allow: [{ type: "m.room_membership", room_id: spaceId }],
          },
        });
      }
      const created = (await (
        client as unknown as {
          createRoom: (
            opts: Record<string, unknown>,
          ) => Promise<{ room_id: string }>;
        }
      ).createRoom({
        name: trimmed,
        topic: topic.trim() || undefined,
        preset: "private_chat",
        initial_state: initialState,
      })) as { room_id: string };
      const newRoomId = created.room_id;
      await (
        client as unknown as {
          sendStateEvent: (
            roomId: string,
            type: string,
            content: Record<string, unknown>,
            stateKey: string,
          ) => Promise<unknown>;
        }
      ).sendStateEvent(
        spaceId,
        "m.space.child",
        { via: [serverName] },
        newRoomId,
      );
      onOpenChange(false);
      reset();
      navigate(`/room/${newRoomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && submitting) return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="create-room-dialog">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Create a room</DialogTitle>
            <DialogDescription>
              Rooms are real-time streams for team conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className={LABEL} htmlFor="room-name">
              Name
            </label>
            <Input
              id="room-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="release-notes"
            />
          </div>
          <div className="space-y-1.5">
            <label className={LABEL} htmlFor="room-topic">
              Topic
              <span className={OPTIONAL}>Optional</span>
            </label>
            <Textarea
              id="room-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={submitting}
              rows={2}
              className="min-h-20 resize-none"
              placeholder="What this room is for"
            />
          </div>
          <div className="flex min-h-12 items-center justify-between gap-4 rounded-card border border-surface-border-primary px-3 py-2">
            <div className="min-w-0">
              <p className={LABEL}>Who can join</p>
              <p className="text-caption1 text-text-secondary">
                {privacy === "space"
                  ? "Anyone in this workspace"
                  : "Only people you invite"}
              </p>
            </div>
            <SegmentedControl
              legend="Who can join"
              options={PRIVACY_OPTIONS}
              value={privacy}
              onValueChange={setPrivacy}
              disabled={submitting}
              testId="create-room-privacy"
              optionTestIdPrefix="create-room-privacy"
            />
          </div>
          {error ? (
            <p className="text-body2 text-accent-danger">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "Creating…" : "Create room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
