import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellIcon, GlobeIcon, LockIcon, PencilIcon, SignOutIcon, StarIcon, UsersIcon } from "@/components/icons";
import { AuxPanelHeader } from "@/components/layout/aux-panel-header";
import { AuxPanel } from "@/components/layout/aux-panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { MatrixClientPeg } from "../../client/peg";
import { useAuxPanelWidth } from "../../hooks/use-aux-panel-width";
import { useJoinRule } from "../../hooks/use-join-rule";
import { useMyPowerLevel } from "../../hooks/use-my-power-level";
import { useRoomFavorite } from "../../hooks/use-room-favorite";
import { useRoomNotifState } from "../../hooks/use-room-notif-state";
import { useRoomTopic } from "../../hooks/use-room-topic";
import type { RoomNotifState } from "../../lib/matrix/notification-prefs";
import { RoomAvatar } from "../room-avatar";
import { MemberPanel } from "./member-panel";

const RULE_LABEL = {
  invite: { Icon: LockIcon, text: "Invite only" },
  restricted: { Icon: UsersIcon, text: "Space members" },
  public: { Icon: GlobeIcon, text: "Anyone can join" },
} as const;

/** Right-pane views, kept in the URL as `?pane=`. Threads move here in W4. */
export const PANE_VIEWS = ["info", "members", "notifications"] as const;
export type PaneView = (typeof PANE_VIEWS)[number];

export function parsePaneView(value: string | null): PaneView | null {
  return PANE_VIEWS.find((v) => v === value) ?? null;
}

const TITLES: Record<PaneView, string> = {
  info: "Room info",
  members: "Members",
  notifications: "Notifications",
};

interface RightPaneProps {
  roomId: string;
  spaceId: string | null;
  view: PaneView;
  onNavigate: (view: PaneView) => void;
  onClose: () => void;
}

// Rows sit inside a p-1 container (like the sidebar user-menu footer), so each row
// has 4px breathing room from the separator and panel edges. Content padding is px-3
// so icon lands at 4+12=16px from the panel edge, same as before.
const ROW = "flex h-8 w-full items-center gap-2.5 px-3 text-body2";
const ACTION_ROW = `${ROW} cursor-pointer rounded-utility transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;

function InfoView({ roomId, onNavigate, onClose }: Omit<RightPaneProps, "view" | "spaceId">) {
  const navigate = useNavigate();
  const client = MatrixClientPeg.safeGet();
  const room = client?.getRoom(roomId);
  const topic = useRoomTopic(roomId);
  const { rule, spaceName } = useJoinRule(roomId);
  const { isFavorite, toggle: toggleFavorite } = useRoomFavorite(roomId);
  const myPL = useMyPowerLevel(roomId);
  const canEdit = myPL.canSendStateEvent("m.room.name");

  const [editingTopic, setEditingTopic] = useState(false);
  const [topicValue, setTopicValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const { Icon: RuleIcon, text: ruleText } = RULE_LABEL[rule];
  const roomName = room?.name ?? roomId;
  const alias = (room as unknown as { getCanonicalAlias?: () => string | null })?.getCanonicalAlias?.() ?? null;
  const memberCount = room?.getJoinedMemberCount() ?? 0;

  const onSaveTopic = async () => {
    await (client as unknown as { setRoomTopic: (r: string, t: string) => Promise<unknown> })
      .setRoomTopic(roomId, topicValue);
    setEditingTopic(false);
  };

  const onSaveName = async () => {
    await (client as unknown as { setRoomName: (r: string, n: string) => Promise<unknown> })
      .setRoomName(roomId, nameValue);
    setEditingName(false);
  };

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    const { content_uri } = await (client as unknown as {
      uploadContent: (f: File) => Promise<{ content_uri: string }>;
    }).uploadContent(file);
    await (client as unknown as {
      sendStateEvent: (r: string, t: string, c: unknown, k: string) => Promise<unknown>;
    }).sendStateEvent(roomId, "m.room.avatar", { url: content_uri }, "");
  };

  const onLeave = async () => {
    await client?.leave(roomId);
    onClose();
    navigate("/");
  };

  return (
    <div className="flex flex-col">
      {/* Avatar + name — uses p-4 block padding, not ROW */}
      <div className="flex items-start gap-3 p-4">
        {canEdit ? (
          <label aria-label="Room avatar" className="cursor-pointer">
            <RoomAvatar roomId={roomId} name={roomName} size="lg" />
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onAvatarChange(e)}
            />
          </label>
        ) : (
          <RoomAvatar roomId={roomId} name={roomName} size="lg" />
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          {editingName ? (
            <div className="flex items-center gap-1">
              <Input
                aria-label="Room name"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-7 text-body2 font-semibold"
              />
              <Button size="sm" onClick={() => void onSaveName()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <p className="truncate font-semibold">{roomName}</p>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0"
                  aria-label="Edit name"
                  onClick={() => { setNameValue(roomName); setEditingName(true); }}
                >
                  <PencilIcon className="size-3" />
                </Button>
              )}
            </div>
          )}
          {alias && <p className="truncate text-caption1 text-muted-foreground">{alias}</p>}
        </div>
      </div>

      {/* Info rows — each row has its own px-4 so icons land at the panel edge */}
      <div className="p-1">
        <div className={`${ROW} text-muted-foreground`}>
          <RuleIcon className="size-4 shrink-0" />
          <span>{ruleText}{rule === "restricted" && spaceName ? ` · ${spaceName}` : ""}</span>
        </div>
        <div className={`${ROW} text-muted-foreground`}>
          <UsersIcon className="size-4 shrink-0" />
          <span>{memberCount} members</span>
        </div>
      </div>

      {/* Topic */}
      <div className="p-1">
        {editingTopic ? (
          <div className="space-y-2 px-3 pb-2">
            <Label htmlFor="topic-input">Topic</Label>
            <Textarea
              id="topic-input"
              aria-label="topic"
              value={topicValue}
              onChange={(e) => setTopicValue(e.target.value)}
              rows={3}
              className="text-body2"
            />
            <div className="flex gap-1">
              <Button size="sm" onClick={() => void onSaveTopic()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTopic(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {topic && <p className="px-3 pb-1 text-body2 text-muted-foreground">{topic}</p>}
            {canEdit && (
              <button
                type="button"
                aria-label="Edit topic"
                className={`${ACTION_ROW} text-muted-foreground`}
                onClick={() => { setTopicValue(topic ?? ""); setEditingTopic(true); }}
              >
                <PencilIcon className="size-4 shrink-0" />
                Edit topic
              </button>
            )}
          </>
        )}
      </div>

      <Separator />

      {/* Action rows — raw <button> so padding is never overridden by a variant */}
      <div className="p-1">
        <button
          type="button"
          className={ACTION_ROW}
          onClick={() => void toggleFavorite()}
        >
          <StarIcon className={`size-4 shrink-0 ${isFavorite ? "fill-current text-accent-warning" : ""}`} />
          {isFavorite ? "Remove from Favourites" : "Add to Favourites"}
        </button>
        <button
          type="button"
          className={ACTION_ROW}
          onClick={() => onNavigate("members")}
        >
          <UsersIcon className="size-4 shrink-0" />
          Members
        </button>
        <button
          type="button"
          className={ACTION_ROW}
          onClick={() => onNavigate("notifications")}
        >
          <BellIcon className="size-4 shrink-0" />
          Notifications
        </button>
      </div>

      <Separator />

      <div className="p-1">
        <button
          type="button"
          className={`${ACTION_ROW} text-destructive hover:bg-destructive/10 hover:text-destructive`}
          onClick={() => void onLeave()}
        >
          <SignOutIcon className="size-4 shrink-0" />
          Leave room
        </button>
      </div>
    </div>
  );
}

function NotificationsView({ roomId }: { roomId: string }) {
  const { state, setState } = useRoomNotifState(roomId);

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3">
        <fieldset className="space-y-1">
          <legend className="sr-only">Notification setting</legend>
          {(["all", "mentions", "mute"] as RoomNotifState[]).map((value) => (
            <label key={value} className="flex h-8 cursor-pointer items-center gap-2.5 text-body2">
              <input
                type="radio"
                name="notif"
                value={value}
                checked={state === value}
                onChange={() => void setState(value)}
                aria-label={value === "all" ? "All messages" : value === "mentions" ? "Mentions & keywords" : "Mute"}
              />
              {value === "all" ? "All messages" : value === "mentions" ? "Mentions & keywords" : "Mute"}
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

export function RightPane({ roomId, spaceId, view, onNavigate, onClose }: RightPaneProps) {
  const { widthPx, onResizeStart, onResetWidth, canReset } = useAuxPanelWidth();
  const title = TITLES[view];

  return (
    <AuxPanel
      label={title}
      testId="right-pane"
      widthPx={widthPx}
      onResizeStart={onResizeStart}
      onResetWidth={onResetWidth}
      canResetWidth={canReset}
      onClose={onClose}
      header={<AuxPanelHeader title={title} onBack={view === "info" ? undefined : () => onNavigate("info")} />}
    >
      {view === "info" && <InfoView roomId={roomId} onNavigate={onNavigate} onClose={onClose} />}
      {view === "notifications" && <NotificationsView roomId={roomId} />}
      {view === "members" && <MemberPanel roomId={roomId} spaceId={spaceId} />}
    </AuxPanel>
  );
}
