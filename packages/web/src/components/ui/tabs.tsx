import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
  className,
  listClassName,
  panelClassName,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: ReactNode }[];
  children: ReactNode;
  className?: string;
  listClassName?: string;
  panelClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div role="tablist" className={cn("mb-4 flex gap-1 border-b border-border", listClassName)}>
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onValueChange(t.value)}
            className={`-mb-px cursor-pointer px-2.5 py-1.5 text-caption1 font-medium transition-colors ${
              value === t.value
                ? "border-b-2 border-accent-brand text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className={panelClassName}>
        {children}
      </div>
    </div>
  );
}
