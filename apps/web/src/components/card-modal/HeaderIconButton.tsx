import type { ComponentProps, ReactNode } from "react";
import { ariaKeyShortcut } from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export function HeaderIconButton({
  children,
  className,
  label,
  pressed,
  shortcut,
  tooltipSide,
  ref,
  ...props
}: ComponentProps<"button"> & {
  children: ReactNode;
  label: string;
  pressed?: boolean;
  shortcut?: readonly string[];
  tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <ShortcutTooltip keys={shortcut} label={label} side={tooltipSide}>
      <button
        aria-keyshortcuts={shortcut ? ariaKeyShortcut(shortcut) : undefined}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg]:size-4",
          className
        )}
        ref={ref}
        type="button"
        {...props}
      >
        {children}
      </button>
    </ShortcutTooltip>
  );
}
