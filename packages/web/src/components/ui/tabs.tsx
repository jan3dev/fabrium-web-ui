import { type ReactNode } from "react";

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: { value: string; label: ReactNode }[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
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
      <div role="tabpanel">{children}</div>
    </div>
  );
}
