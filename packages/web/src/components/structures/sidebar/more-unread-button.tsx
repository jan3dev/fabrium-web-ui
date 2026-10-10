// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/sidebar/ui/MoreUnreadButton.tsx. Modified.
import { type RefObject, useEffect, useState } from "react";

import { UnreadPill } from "@/components/ui/unread-pill";

type Side = { count: number; highlight: boolean };
type Overflow = { above: Side; below: Side };

const NONE: Overflow = {
  above: { count: 0, highlight: false },
  below: { count: 0, highlight: false },
};

/** Unread rows (`[data-unread]`) scrolled out of view above and below the container. */
function unreadOutOfView(container: HTMLElement) {
  const box = container.getBoundingClientRect();
  const above: HTMLElement[] = [];
  const below: HTMLElement[] = [];
  for (const row of container.querySelectorAll<HTMLElement>("[data-unread]")) {
    const r = row.getBoundingClientRect();
    if (r.bottom <= box.top) above.push(row);
    else if (r.top >= box.bottom) below.push(row);
  }
  return { above, below };
}

function summarize(rows: HTMLElement[]): Side {
  return {
    count: rows.length,
    highlight: rows.some((r) => r.dataset.unread === "highlight"),
  };
}

/** Tracks unread rows hidden by scrolling, so the sidebar can point at them. */
export function useUnreadOverflow(scrollRef: RefObject<HTMLElement | null>) {
  const [overflow, setOverflow] = useState<Overflow>(NONE);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const update = () => {
      const { above, below } = unreadOutOfView(container);
      const next = { above: summarize(above), below: summarize(below) };
      setOverflow((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(container);
    const mutations = new MutationObserver(update);
    mutations.observe(container, {
      subtree: true,
      childList: true,
      attributeFilter: ["data-unread"],
    });
    return () => {
      container.removeEventListener("scroll", update);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [scrollRef]);

  const scrollTo = (position: "top" | "bottom") => {
    const container = scrollRef.current;
    if (!container) return;
    const { above, below } = unreadOutOfView(container);
    // The nearest hidden row in that direction.
    const target = position === "top" ? above.at(-1) : below[0];
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return { overflow, scrollTo };
}

export function MoreUnreadButton({
  count,
  emphasis,
  onClick,
  position,
}: {
  count: number;
  emphasis: "default" | "primary";
  onClick: () => void;
  position: "top" | "bottom";
}) {
  const label = `${count} unread`;
  const direction = position === "top" ? "above" : "below";

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-2 py-1 ${
        position === "top" ? "top-0" : "bottom-0"
      }`}
    >
      <UnreadPill
        accessibleLabel={`${label} ${direction}`}
        className="max-w-full overflow-hidden"
        direction={position === "top" ? "up" : "down"}
        emphasis={emphasis}
        label={label}
        onClick={onClick}
      />
    </div>
  );
}
