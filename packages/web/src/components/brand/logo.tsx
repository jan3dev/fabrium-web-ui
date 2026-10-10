import { cn } from "@/lib/utils";

/** Placeholder wordmark (O2): the one place the product mark lives, so a real logo is a one-file swap. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn("font-heading text-h4 font-semibold text-text-primary", className)}>Fabrium</span>;
}
