// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/ui/switch.tsx. Modified.
import * as React from "react";
import { Switch as SwitchPrimitives } from "radix-ui";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-surface-border-primary p-px transition-colors focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent-brand data-[state=checked]:bg-accent-brand data-[state=unchecked]:bg-surface-tertiary",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-surface-primary shadow-button transition-transform duration-(--duration-fast) ease-standard data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
