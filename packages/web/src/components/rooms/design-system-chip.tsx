import { PaletteIcon } from "@/components/icons";

/**
 * Under the message box (spec §3.1): the design system new slides and designs use, or
 * "No design system". Users change their own in Settings › Design systems.
 */
export function DesignSystemChip({ name }: { name: string | null }) {
  return (
    <div className="mt-1.5 flex px-1">
      <span
        data-testid="design-system-chip"
        title="Change yours in Settings › Design systems"
        className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-pill border border-border px-2 py-0.5 text-caption1 text-text-secondary"
      >
        <PaletteIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{name ?? "No design system"}</span>
      </span>
    </div>
  );
}
