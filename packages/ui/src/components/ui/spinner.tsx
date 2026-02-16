import { Loader2Icon } from "lucide-react";

import { cn } from "../../lib/utils";

interface SpinnerProps {
  className?: string;
}

function Spinner({ className }: SpinnerProps) {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      role="status"
    />
  );
}

export { Spinner };
