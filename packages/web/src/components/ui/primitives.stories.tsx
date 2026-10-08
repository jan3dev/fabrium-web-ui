import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CloseIcon,
  InfoIcon,
  PencilIcon,
  TrashIcon,
  WarningIcon,
} from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { SegmentedControl } from "@/components/ui/segmented-control";

const meta = {
  title: "UI/Primitives",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alerts: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <Alert tone="info">
        <InfoIcon />
        <div>
          <AlertTitle>Agents are read-only here</AlertTitle>
          <AlertDescription>
            Coder · Payments can read this channel but not post.
          </AlertDescription>
        </div>
      </Alert>
      <Alert tone="success">
        <AlertDescription>Approval sent.</AlertDescription>
      </Alert>
      <Alert tone="warning">
        <WarningIcon />
        <AlertDescription>
          This server does not support message search.
        </AlertDescription>
      </Alert>
      <Alert tone="danger">
        <AlertDescription>Could not join the room.</AlertDescription>
      </Alert>
    </div>
  ),
};

export const IconButtons: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <IconButton icon={<PencilIcon />} label="Edit" />
      <IconButton icon={<TrashIcon />} label="Delete" tone="danger" />
      <IconButton icon={<InfoIcon />} label="Room info" tone="brand" />
      <IconButton
        icon={<CloseIcon />}
        label="Close"
        tone="neutral"
        size="small"
      />
      <IconButton icon={<PencilIcon />} label="Compose" tone="primary" />
      <IconButton icon={<PencilIcon />} label="Edit (disabled)" disabled />
    </div>
  ),
};

export const Keys: Story = {
  render: () => (
    <p className="flex items-center gap-1 text-body2 text-text-secondary">
      Switch rooms with <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>, search with <Kbd>⌘</Kbd>
      <Kbd>G</Kbd>
    </p>
  ),
};

function SegmentedDemo() {
  const [value, setValue] = useState<"system" | "light" | "dark">("system");
  return (
    <SegmentedControl
      legend="Theme"
      onValueChange={setValue}
      optionTestIdPrefix="theme"
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
      testId="theme-control"
      value={value}
    />
  );
}

export const Segmented: Story = { render: () => <SegmentedDemo /> };

export const ContextMenuOnRightClick: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-24 w-64 items-center justify-center rounded-card border border-dashed text-body2 text-text-secondary">
        Right-click here
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>
          Mark as read <ContextMenuShortcut>⇧Esc</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>Copy link</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">Leave room</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const AlertDialogOpen: Story = {
  render: () => (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">Leave room</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave #payments?</AlertDialogTitle>
          <AlertDialogDescription>
            You can rejoin from the room browser.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Leave</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
};
