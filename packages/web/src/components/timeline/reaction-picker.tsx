import { lazy, Suspense, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PickerEmoji = lazy(() => import("./reaction-picker-emoji"));

/** Emoji picker in a popover, opened by `trigger`. */
export function ReactionPicker({
  onPick,
  onOpenChange,
  trigger,
}: {
  onPick: (emoji: string) => void;
  onOpenChange?: (open: boolean) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-auto border-0 bg-transparent p-0 shadow-none">
        <Suspense fallback={<div className="p-3 text-caption1 text-text-secondary">Loading…</div>}>
          {open && (
            <PickerEmoji
              onPick={(emoji) => {
                change(false);
                onPick(emoji);
              }}
            />
          )}
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
