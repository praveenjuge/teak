import type { FolderColor } from "@teak/convex/shared/folders";
import { FOLDER_DOT_CLASSES } from "../../lib/folders";
import { cn } from "../../lib/utils";

/** The small color mark beside a folder's name. */
export function FolderDot({
  color,
  className,
}: {
  className?: string;
  color?: FolderColor;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        color
          ? FOLDER_DOT_CLASSES[color]
          : "border-[1.5px] border-muted-foreground/50",
        className
      )}
    />
  );
}
