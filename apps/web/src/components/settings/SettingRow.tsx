import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CardTitle } from "../ui/card";

interface SettingRowProps {
  children: ReactNode;
  title: string;
}

export function SettingRow({ title, children }: SettingRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle className="shrink-0">{title}</CardTitle>
      <div className="-mx-2.5 flex min-h-8 min-w-0 flex-1 items-center justify-end gap-2 -space-x-2.5">
        {children}
      </div>
    </div>
  );
}

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
