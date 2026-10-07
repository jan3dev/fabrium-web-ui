// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/ui/checkbox.tsx. Modified.
import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// The tick draws in with a CSS @starting-style transition (no motion library);
// the global reduced-motion rule flattens it.
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer size-4 shrink-0 cursor-pointer rounded-[4px] border border-surface-border-secondary bg-surface-secondary focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent-brand data-[state=checked]:bg-accent-brand data-[state=checked]:text-button-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
        <path
          className="transition-[stroke-dashoffset] duration-(--duration-base) ease-standard [stroke-dasharray:24] starting:[stroke-dashoffset:24]"
          d="m5 12 4 4L19 6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
