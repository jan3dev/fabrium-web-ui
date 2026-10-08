import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Centered card with the wordmark above it: the frame of every signed-out screen. */
export function AuthCard({
  title,
  description,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6">
      <Logo />
      <Card elevation="raised" className={cn("w-full max-w-sm gap-6 py-6", className)}>
        <CardHeader className="px-6">
          <CardTitle className="text-h5">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6">{children}</CardContent>
      </Card>
    </div>
  );
}
