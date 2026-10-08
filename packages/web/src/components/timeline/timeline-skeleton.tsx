// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/messages/ui/TimelineSkeleton.tsx. Modified.
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ROWS = [
  { key: "first", author: "w-28", lines: ["w-full", "w-4/5"] },
  { key: "second", author: "w-24", lines: ["w-full", "w-2/3"] },
  { key: "third", author: "w-32", lines: ["w-5/6"] },
  { key: "fourth", author: "w-20", lines: ["w-full", "w-4/5"] },
];

/** Placeholder rows while a room's first page of history loads. */
export function TimelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading messages" role="status" className="flex flex-col justify-end px-2 py-3">
      {ROWS.map((row) => (
        <div className="mx-1 flex items-start gap-2.5 px-2 py-2" key={row.key}>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-3.5", row.author)} />
            {row.lines.map((width) => (
              <Skeleton className={cn("h-4", width)} key={width} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
