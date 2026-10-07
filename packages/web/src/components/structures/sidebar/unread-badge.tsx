interface UnreadBadgeProps {
  total: number;
  highlight: number;
}

/** Unread count pill: brand-filled when it includes a mention, neutral otherwise. */
export function UnreadBadge({ total, highlight }: UnreadBadgeProps) {
  if (total <= 0) return null;
  const display = total > 99 ? "99+" : String(total);
  const tone =
    highlight > 0
      ? "bg-button-primary-background text-button-primary-foreground"
      : "bg-sidebar-accent text-sidebar-foreground/70";
  return (
    <span
      aria-label={`${total} unread`}
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill px-1.5 text-caption2 font-semibold tabular-nums ${tone}`}
    >
      {display}
    </span>
  );
}
