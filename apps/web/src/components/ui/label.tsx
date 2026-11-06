"use client";

import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";

import { cn } from "../../lib/utils";

function Label({
  asChild = false,
  className,
  onMouseDown,
  ...props
}: React.ComponentProps<"label"> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "label";
  return (
    <Component
      className={cn(
        "flex select-none items-center gap-2 font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        className
      )}
      data-slot="label"
      onMouseDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, input, select, textarea")
        ) {
          return;
        }
        onMouseDown?.(event);
        if (!event.defaultPrevented && event.detail > 1) {
          event.preventDefault();
        }
      }}
      {...props}
    />
  );
}

export { Label };
