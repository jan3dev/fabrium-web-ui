import type { ReactNode } from "react";
import { useSafeNavigate } from "@/hooks/use-safe-navigate";
import { parseThreadLink, threadTargetPath } from "@/lib/matrix/permalinks";

/** A link in a message body: thread and room links route in-app, everything else opens a tab. */
export function MessageLink({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useSafeNavigate();
  const target = parseThreadLink(href, window.location.origin);
  const roomId = /^https:\/\/matrix\.to\/#\/(![^/?]+)$/.exec(href)?.[1];
  const path = target
    ? threadTargetPath(target)
    : roomId
      ? `/room/${encodeURIComponent(decodeURIComponent(roomId))}`
      : null;
  if (!path) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer ugc" className="text-primary underline">
        {children}
      </a>
    );
  }
  return (
    <a
      href={path}
      className="text-primary underline"
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(path);
      }}
    >
      {children}
    </a>
  );
}
