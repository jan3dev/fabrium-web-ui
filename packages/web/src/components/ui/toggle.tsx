// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/ui/toggle.tsx. Modified.
import * as React from "react";
import { Toggle as TogglePrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-utility text-body2 font-medium text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-surface-selected data-[state=on]:text-accent-brand [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        ghost:
          "bg-transparent data-[state=on]:bg-surface-secondary data-[state=on]:text-text-primary",
        outline:
          "border border-surface-border-secondary bg-transparent data-[state=on]:bg-surface-secondary data-[state=on]:text-text-primary",
      },
      size: {
        default: "h-9 px-3 min-w-9",
        xs: "h-5 min-h-0 min-w-0 gap-1 px-1.5 text-caption1 font-medium [&_svg]:size-3.5",
        sm: "h-8 px-2 min-w-8",
        lg: "h-10 px-3 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Toggle = React.forwardRef<
  React.ComponentRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
));

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
