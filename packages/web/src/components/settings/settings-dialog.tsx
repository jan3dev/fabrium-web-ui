import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { AppearanceSection } from "./appearance-section";
import { NotificationSection } from "./notification-section";
import { ProfileSection } from "./profile-section";

export function SettingsDialog({
  open,
  onOpenChange,
  pushGatewayUrl,
  vapidPublicKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pushGatewayUrl?: string;
  vapidPublicKey?: string;
}) {
  const [tab, setTab] = useState("profile");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "profile", label: "Profile" },
            { value: "notifications", label: "Notifications" },
            { value: "appearance", label: "Appearance" },
          ]}
        >
          {tab === "profile" ? (
            <ProfileSection onSaved={() => onOpenChange(false)} />
          ) : tab === "notifications" ? (
            <NotificationSection pushGatewayUrl={pushGatewayUrl} vapidPublicKey={vapidPublicKey} />
          ) : (
            <AppearanceSection />
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
