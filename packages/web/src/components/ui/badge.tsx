import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// A small status pill. Tone carries no meaning on its own: keep the text descriptive.
// agent/human/system/enclave mark actors and trust, never general status.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-pill border border-transparent px-2.5 py-0.5 text-caption1 font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-surface-tertiary text-text-secondary",
        success: "bg-chip-success-background text-chip-success-foreground",
        warning: "bg-accent-warning-transparent text-accent-warning",
        danger: "bg-chip-error-background text-chip-error-foreground",
        // Its own token: --accent-brand at 12px on a dark surface is under AA.
        brand: "bg-chip-brand-background text-chip-brand-foreground",
        outline: "border-surface-border-secondary text-text-secondary",
        agent: "bg-actor-agent-transparent text-actor-agent",
        human: "bg-actor-human-transparent text-actor-human",
        system: "bg-actor-system-transparent text-text-secondary",
        enclave: "bg-trust-enclave-transparent text-trust-enclave",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

function Badge({
  className,
  tone = "neutral",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
