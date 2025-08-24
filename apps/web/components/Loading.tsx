import { Loader2Icon } from "lucide-react";

export function Loading({
  fullScreen,
  className,
}: {
  fullScreen?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`grid place-items-center ${fullScreen ? "min-h-screen w-full" : "size-full"} ${className}`}
    >
      <Loader2Icon className="animate-spin text-muted-foreground" />
    </div>
  );
}
