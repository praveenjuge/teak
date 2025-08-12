import { Loader2Icon } from "lucide-react";

export function Loading({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div
      className={`grid place-items-center ${fullScreen ? "min-h-screen w-full" : "size-full"}`}
    >
      <Loader2Icon className="animate-spin text-muted-foreground" />
    </div>
  );
}
