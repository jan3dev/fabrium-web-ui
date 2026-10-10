// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/DayDivider.tsx. Modified.

/** Centered date chip on a hairline between messages from different days. */
export function DayDivider({ label }: { label: string }) {
  return (
    <section
      aria-label={label}
      className="pointer-events-none relative flex justify-center py-2 before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-surface-border-primary before:content-['']"
      data-testid="message-timeline-day-divider"
    >
      <p className="relative rounded-pill border border-surface-border-primary bg-surface-background px-2.5 py-1 text-caption2 font-medium text-text-secondary">
        {label}
      </p>
    </section>
  );
}
