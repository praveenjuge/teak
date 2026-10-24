import { cn } from "../../lib/utils";

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
