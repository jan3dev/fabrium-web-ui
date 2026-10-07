import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-utility border border-surface-border-secondary bg-surface-secondary px-3 py-2 text-body2 text-text-primary transition-colors duration-(--duration-fast) ease-standard placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-accent-danger file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body2 file:font-medium file:text-text-primary",
        className
      )}
      {...props}
    />
  )
}

export { Input }
