"use client";

import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";

import { cn } from "../../lib/utils";

function Separator({
  asChild = false,
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}) {
  const Component = asChild ? Slot : "div";
  const direction = orientation === "vertical" ? "vertical" : "horizontal";
  return (
    <Component
      aria-orientation={
        !decorative && direction === "vertical" ? direction : undefined
      }
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
        className
      )}
      data-orientation={direction}
      data-slot="separator"
      role={decorative ? "none" : "separator"}
      {...props}
    />
  );
}

export { Separator };
