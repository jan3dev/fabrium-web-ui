// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/home/ui/HomeLoadingState.tsx. Modified.
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows while the inbox loads. */
export function InboxListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading inbox" role="status">
      {["first", "second", "third", "fourth", "fifth"].map((row) => (
        <div className="flex w-full items-start gap-2.5 px-4 py-3" key={row}>
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-3 w-10" />
            </div>
            <Skeleton className="mt-1.5 h-3 w-32" />
            <div className="mt-1.5 space-y-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
