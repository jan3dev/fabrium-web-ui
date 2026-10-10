// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/shared/ui/alert.tsx. Modified.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-card border p-4 text-body2 text-text-secondary [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        info: "border-surface-border-primary bg-surface-secondary [&>svg]:text-text-secondary",
        success: "border-accent-success bg-accent-success-transparent [&>svg]:text-accent-success",
        warning: "border-accent-warning bg-accent-warning-transparent [&>svg]:text-accent-warning",
        danger: "border-accent-danger bg-accent-danger-transparent [&>svg]:text-accent-danger",
      },
    },
    defaultVariants: {
      tone: "info",
    },
  },
);

// Danger and warning are announced (role="alert"); info and success are not, so
// they don't interrupt. A caller-supplied role wins.
const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, tone, role, ...props }, ref) => (
  <div
    className={cn(alertVariants({ tone }), className)}
    data-tone={tone ?? "info"}
    ref={ref}
    role={role ?? (tone === "danger" || tone === "warning" ? "alert" : undefined)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    className={cn("mb-1 font-sans text-body2 font-semibold text-text-primary", className)}
    ref={ref}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div className={cn("text-body2", className)} ref={ref} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
