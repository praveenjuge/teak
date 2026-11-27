import type { ReactNode } from "react";

/**
 * The row along the bottom of a link or document card, inside its frame:
 * icon, name, one short detail (a price, a file type) and the card's marks.
 * The Pinned row hides it by its `data-card-footer` attribute.
 */
export function CardFooter({
  detail,
  icon,
  marks,
  title,
}: {
  detail?: string;
  icon: ReactNode;
  marks?: ReactNode;
  title: string;
}) {
  return (
    <div
      className="flex h-10 min-w-0 items-center gap-2 border-border/80 border-t pr-2 pl-3"
      data-card-footer=""
    >
      {icon}
      <p
        className="min-w-0 flex-1 truncate font-medium text-[13px] leading-snug"
        dir="auto"
      >
        {title}
      </p>
      {detail ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {detail}
        </span>
      ) : null}
      {marks}
    </div>
  );
}
