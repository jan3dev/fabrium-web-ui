// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/layout/AuxiliaryPanelHeader.tsx. Modified.
import * as React from "react";

import { ArrowLeftIcon, CloseIcon } from "@/components/icons";
import { AuxPanelContext } from "@/components/layout/aux-panel-shell";
import { IconButton } from "@/components/ui/icon-button";

/** Title row for the right pane: optional back button, title, actions, and the close button. */
export function AuxPanelHeader({
  title,
  onBack,
  actions,
}: {
  title: React.ReactNode;
  onBack?: () => void;
  actions?: React.ReactNode;
}) {
  const panel = React.useContext(AuxPanelContext);

  return (
    <div className="flex min-h-12 shrink-0 cursor-default items-center gap-1.5 border-b border-border px-3 select-none">
      {onBack ? (
        <IconButton
          icon={<ArrowLeftIcon />}
          label="Back"
          onClick={onBack}
          size="small"
          tooltip={false}
        />
      ) : null}
      <h2 className="min-w-0 flex-1 truncate pl-1 font-heading text-subtitle font-semibold">
        {title}
      </h2>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {actions}
        {panel ? (
          <IconButton
            icon={<CloseIcon />}
            label="Close panel"
            onClick={panel.onClose}
            size="small"
            tooltip={false}
          />
        ) : null}
      </div>
    </div>
  );
}
