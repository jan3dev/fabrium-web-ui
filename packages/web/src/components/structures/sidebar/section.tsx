// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/SidebarSection.tsx. Modified.
import { type ReactNode, useId, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-4rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "size-3 shrink-0 opacity-0 transition-[opacity,rotate] group-hover/sidebar-section:opacity-100 group-focus-within/sidebar-section:opacity-100";

/** Small icon button for a section header (add room, start DM). Shown on hover from `md` up. */
export const SECTION_ICON_BUTTON_CLASS =
  "flex size-6 cursor-pointer items-center justify-center rounded-utility p-1 text-sidebar-foreground/50 transition-[color,background-color,opacity] hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring md:opacity-0 md:group-hover/sidebar-section:opacity-100 md:group-focus-within/sidebar-section:opacity-100 [&>svg]:size-4 [&>svg]:shrink-0";

interface SectionProps {
  title: string;
  action?: ReactNode;
  /** `SidebarMenuItem` rows. */
  children: ReactNode;
  defaultExpanded?: boolean;
  /** When set, expand/collapse state persists to localStorage under this key. */
  storageKey?: string;
}

function readPersisted(
  storageKey: string | undefined,
  fallback: boolean,
): boolean {
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === "expanded") return true;
    if (raw === "collapsed") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function Section({
  title,
  action,
  children,
  defaultExpanded = true,
  storageKey,
}: SectionProps) {
  const [expanded, setExpanded] = useState(() =>
    readPersisted(storageKey, defaultExpanded),
  );
  const contentId = useId();

  const toggle = () => {
    setExpanded((e) => {
      const next = !e;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next ? "expanded" : "collapsed");
        } catch {
          // A private window throws on access — a section that fails to
          // remember must still render.
        }
      }
      return next;
    });
  };

  return (
    <SidebarGroup
      role="region"
      aria-label={title}
      className="group/sidebar-section py-1 select-none"
    >
      <div className="relative flex items-center">
        <SidebarGroupLabel asChild>
          <button
            type="button"
            aria-label={`toggle ${title} section`}
            aria-controls={contentId}
            aria-expanded={expanded}
            className={SECTION_LABEL_BUTTON_CLASS}
            onClick={toggle}
          >
            <span className="truncate">{title}</span>
            <ChevronDownIcon
              aria-hidden
              className={cn(
                SECTION_LABEL_CHEVRON_CLASS,
                !expanded && "-rotate-90 opacity-100",
              )}
            />
          </button>
        </SidebarGroupLabel>
        <div className="ml-auto flex items-center gap-1 pr-1">{action}</div>
      </div>
      {expanded ? (
        <SidebarGroupContent id={contentId}>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}
