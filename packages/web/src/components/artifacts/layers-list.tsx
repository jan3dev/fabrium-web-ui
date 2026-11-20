import { useEffect, useRef } from "react";
import { LockIcon } from "@/components/icons";
import type { LayerInfo } from "@/lib/artifacts/canvas";
import { cn } from "@/lib/utils";

/**
 * The layers of the open slide or artboard (spec §6.5), named by `data-layer` or by tag and
 * first text. It mirrors the canvas selection both ways: a click selects (Shift or Cmd adds),
 * and the selected rows follow the canvas. Locked layers are listed, not selectable.
 */
export function LayersList({
  layers,
  selected,
  onSelect,
}: {
  layers: readonly LayerInfo[];
  selected: readonly string[];
  onSelect: (ids: string[]) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const first = selected[0];
  useEffect(() => {
    if (first) ref.current?.querySelector(`[data-layer-id="${first}"]`)?.scrollIntoView({ block: "nearest" });
  }, [first]);
  if (layers.length === 0) return <p className="text-caption1 text-text-tertiary">No layers.</p>;
  return (
    <ul ref={ref} aria-label="Layers" data-testid="layers-list" className="flex max-h-64 flex-col overflow-y-auto">
      {layers.map((l) => {
        const on = selected.includes(l.id);
        return (
          <li key={l.id}>
            <button
              type="button"
              data-layer-id={l.id}
              aria-pressed={on}
              disabled={l.locked}
              onClick={(e) =>
                onSelect(
                  e.shiftKey || e.metaKey || e.ctrlKey
                    ? on
                      ? selected.filter((id) => id !== l.id)
                      : [...selected, l.id]
                    : [l.id],
                )
              }
              // Indent by depth: layout, not colour.
              style={{ paddingLeft: `${8 + Math.min(l.depth, 8) * 12}px` }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-utility py-1 pr-2 text-left text-caption1",
                on ? "bg-accent-brand-transparent text-text-primary" : "text-text-secondary hover:bg-surface-secondary",
                l.locked && "cursor-default",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {l.locked ? (
                <>
                  <LockIcon className="size-3 shrink-0" />
                  <span className="sr-only">locked</span>
                </>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
