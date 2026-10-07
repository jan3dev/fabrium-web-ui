import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "scrollbar-custom flex field-sizing-content min-h-16 w-full rounded-utility border border-surface-border-secondary bg-surface-secondary px-3 py-2 text-body2 text-text-primary transition-colors duration-(--duration-fast) ease-standard placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-accent-danger",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
