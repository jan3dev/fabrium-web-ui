import { useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PhoneIcon,
  PointerClickIcon,
  ReloadIcon,
  TabletIcon,
} from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";

export type PreviewDevice = "desktop" | "tablet" | "phone";

/** Frame width per device; desktop fills the panel. */
export const DEVICE_WIDTH: Record<PreviewDevice, number | null> = { desktop: null, tablet: 768, phone: 390 };

const DEVICES = [
  { value: "desktop", label: "Desktop width", Icon: MonitorIcon },
  { value: "tablet", label: "Tablet width (768 px)", Icon: TabletIcon },
  { value: "phone", label: "Phone width (390 px)", Icon: PhoneIcon },
] as const;

/** The path field: shows where the app is, takes a path to go to. The host is fixed and never shown. */
function PathField({ path, disabled, onNavigate }: { path: string; disabled: boolean; onNavigate: (path: string) => void }) {
  const [draft, setDraft] = useState(path);
  return (
    <form
      className="min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        onNavigate(draft);
      }}
    >
      <input
        aria-label="Page path"
        data-testid="preview-path"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(path)}
        onKeyDown={(e) => e.key === "Escape" && setDraft(path)}
        className="h-7 w-full min-w-0 rounded-utility border border-border bg-surface-secondary px-2 font-mono text-caption1 text-text-primary outline-none focus:border-surface-border-selected disabled:text-text-tertiary"
      />
    </form>
  );
}

/** Controls over the app frame. `disabled` while the app is not running. */
export function PreviewToolbar({
  path,
  disabled,
  device,
  annotating,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onDeviceChange,
  onAnnotatingChange,
  onOpenInNewTab,
}: {
  path: string;
  disabled: boolean;
  device: PreviewDevice;
  annotating: boolean;
  onNavigate: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onDeviceChange: (device: PreviewDevice) => void;
  /** Absent: the viewer may not annotate, and the button is hidden. */
  onAnnotatingChange?: (on: boolean) => void;
  onOpenInNewTab: () => void;
}) {
  return (
    <div data-testid="preview-toolbar" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2">
      <IconButton size="small" icon={<ArrowLeftIcon />} label="Back" disabled={disabled} onClick={onBack} />
      <IconButton size="small" icon={<ArrowRightIcon />} label="Forward" disabled={disabled} onClick={onForward} />
      <IconButton size="small" icon={<ReloadIcon />} label="Reload" disabled={disabled} onClick={onReload} />
      {/* Keyed by path: a page change from the app replaces what the field shows. */}
      <PathField key={path} path={path} disabled={disabled} onNavigate={onNavigate} />
      {onAnnotatingChange ? (
        <IconButton
          size="small"
          icon={<PointerClickIcon />}
          label={annotating ? "Stop annotating" : "Annotate"}
          aria-pressed={annotating}
          tone={annotating ? "brand" : "default"}
          disabled={disabled}
          onClick={() => onAnnotatingChange(!annotating)}
        />
      ) : null}
      <div role="group" aria-label="Device width" className="hidden items-center gap-0.5 md:flex">
        {DEVICES.map(({ value, label, Icon }) => (
          <IconButton
            key={value}
            size="small"
            icon={<Icon />}
            label={label}
            aria-pressed={device === value}
            tone={device === value ? "brand" : "default"}
            onClick={() => onDeviceChange(value)}
          />
        ))}
      </div>
      <IconButton
        size="small"
        icon={<ExternalLinkIcon />}
        label="Open in new tab"
        disabled={disabled}
        onClick={onOpenInNewTab}
      />
    </div>
  );
}
