import { cn } from "@/lib/utils"

// One key. Write a chord as one <Kbd> per key: ⌘ and K are two keys.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex min-w-4 items-center justify-center rounded-utility bg-kbd-background px-1 py-0.5 font-sans text-caption2 leading-none font-normal text-text-tertiary",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
