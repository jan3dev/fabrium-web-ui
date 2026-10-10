import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// A square, icon-only control. `label` is required: it is the accessible name and
// the hover label, since there is no text to read otherwise.
const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-utility transition-[color,background-color] duration-(--duration-fast) ease-standard disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        default: "text-text-tertiary hover:bg-surface-secondary hover:text-text-primary",
        brand: "text-accent-brand hover:bg-accent-brand-transparent",
        danger: "text-text-tertiary hover:bg-accent-danger-transparent hover:text-accent-danger",
        primary:
          "bg-button-primary-background text-button-primary-foreground hover:brightness-95 active:brightness-90",
        neutral: "bg-surface-secondary text-text-primary hover:bg-surface-tertiary",
      },
      size: {
        small: "size-7 [&_svg]:size-3.5",
        medium: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { tone: "default", size: "medium" },
  }
)

type IconButtonProps = Omit<React.ComponentProps<"button">, "children"> &
  VariantProps<typeof iconButtonVariants> & {
    icon: React.ReactNode
    label: string
    tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"]
    /** Hide the hover label when the meaning is already visible beside the control. */
    tooltip?: boolean
  }

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tone, size, className, tooltipSide = "top", tooltip = true, ...props },
  ref
) {
  const button = (
    <button
      ref={ref}
      type="button"
      data-slot="icon-button"
      aria-label={label}
      className={cn(iconButtonVariants({ tone, size }), className)}
      {...props}
    >
      {icon}
    </button>
  )
  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  )
})

export { IconButton, iconButtonVariants }
