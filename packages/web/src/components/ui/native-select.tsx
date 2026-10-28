import * as React from "react"

import { cn } from "@/lib/utils"

// A native <select> styled like Input: the browser supplies the menu, keyboard, and accessibility.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-9 w-full min-w-0 rounded-utility border border-surface-border-secondary bg-surface-secondary px-3 py-2 text-body2 text-text-primary transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-accent-danger",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
