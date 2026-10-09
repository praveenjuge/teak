import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CardTitle } from "../ui/card";

interface SettingRowProps {
  children: ReactNode;
  title: string;
}

export function SettingRow({ title, children }: SettingRowProps) {
  return (
    // The value area keeps a fixed height and a fixed start edge, so swapping
    // a placeholder for the loaded value never moves the row or its siblings.
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle>{title}</CardTitle>
      <div className="-mx-2.5 flex min-h-8 min-w-0 flex-1 items-center justify-end gap-2 -space-x-2.5">
        {children}
      </div>
    </div>
  );
}

/** Placeholder sized like the value it stands in for, so nothing moves. */
export function SettingValueSkeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mx-2.5 block h-4 animate-pulse rounded-full bg-muted",
        className
      )}
      data-slot="setting-value-skeleton"
    />
  );
}
