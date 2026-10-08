// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/MessageThreadPanelSkeleton.tsx. Modified.
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder row standing in for a thread message while it loads. */
export function ThreadMessageSkeleton({ isHead = false }: { isHead?: boolean }) {
  return (
    <div
      className="relative mx-1 flex items-start gap-2.5 px-2 pt-2 pb-1.5"
      aria-busy="true"
      role="status"
      aria-label={isHead ? "Loading thread parent" : "Loading reply"}
    >
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="mt-1.5 space-y-1.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className={isHead ? "h-3.5 w-4/5" : "h-3.5 w-2/3"} />
        </div>
      </div>
    </div>
  );
}
