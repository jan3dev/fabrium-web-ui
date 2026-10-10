import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Variants follow the design system (primary/secondary/tertiary pills, utility
// squares). The shadcn names stay as aliases so existing call sites keep working:
// default→primary, outline→secondary, ghost→tertiary, destructive→utility + danger.
const PRIMARY =
  "rounded-pill bg-button-primary-background text-button-primary-foreground hover:brightness-95 active:brightness-90"
const SECONDARY =
  "rounded-pill border-surface-border-secondary bg-surface-secondary text-text-secondary hover:bg-surface-tertiary hover:text-text-primary aria-expanded:bg-surface-tertiary"
const TERTIARY =
  "rounded-pill bg-transparent text-text-secondary hover:bg-surface-secondary hover:text-text-primary aria-expanded:bg-surface-secondary"
const UTILITY =
  "rounded-utility bg-button-utility-background text-button-utility-foreground shadow-button hover:bg-surface-tertiary"
const DANGER =
  "rounded-utility border-accent-danger/30 bg-accent-danger-transparent text-accent-danger shadow-none hover:border-accent-danger"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center border border-transparent font-sans font-semibold whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,filter] duration-(--duration-fast) ease-standard disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-accent-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: PRIMARY,
        secondary: SECONDARY,
        tertiary: TERTIARY,
        utility: UTILITY,
        default: PRIMARY,
        outline: SECONDARY,
        ghost: TERTIARY,
        destructive: DANGER,
        link: "h-auto! px-0! text-accent-brand underline-offset-4 hover:underline",
      },
      tone: {
        default: "",
        danger: DANGER,
      },
      size: {
        // Pill heights: h-14 is the full-size control, h-10 the dense chat-chrome one.
        lg: "h-14 gap-2 px-8 text-body1 [&_svg:not([class*='size-'])]:size-5",
        default: "h-10 gap-2 px-5 text-body2",
        // Utility heights (34px / 28px).
        sm: "h-[34px] gap-1.5 px-3.5 text-body2",
        xs: "h-7 gap-1 px-2.5 text-caption1 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 rounded-utility",
        "icon-lg": "size-10 rounded-utility",
        "icon-sm": "size-7 rounded-utility [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-6 rounded-utility [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean
    }
>(function Button(
  { className, variant = "default", tone = "default", size = "default", asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-tone={tone}
      className={cn(buttonVariants({ variant, tone, size, className }))}
      {...props}
    />
  )
})

export { Button, buttonVariants }
