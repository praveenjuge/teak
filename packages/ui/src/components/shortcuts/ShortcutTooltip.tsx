"use client";

import { Kbd, KbdGroup } from "@teak/ui/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@teak/ui/components/ui/tooltip";
import type { ComponentProps, ReactElement } from "react";
import { useIsApplePlatform } from "../../hooks/useIsApplePlatform";
import { platformKey } from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";

/**
 * Keycaps for keys pressed together, as this platform labels them (`Mod`
 * is ⌘ or Ctrl). Decorative: the control names its keys with
 * `aria-keyshortcuts`.
 */
export function ShortcutKeys({
  className,
  keys,
}: {
  className?: string;
  keys: readonly string[];
}) {
  const apple = useIsApplePlatform();
  return (
    <KbdGroup aria-hidden="true" className={className}>
      {keys.map((key) => (
        <Kbd key={key}>{platformKey(key, apple)}</Kbd>
      ))}
    </KbdGroup>
  );
}

/** For `ShortcutKeys` inside a primary button: keycaps on its fill. */
export const PRIMARY_BUTTON_KEYS_CLASS =
  "max-sm:hidden [&_kbd]:border-transparent [&_kbd]:bg-primary-foreground/20 [&_kbd]:text-primary-foreground";

interface ShortcutTooltipProps {
  /** The control the tooltip names; it should set `aria-keyshortcuts`. */
  children: ReactElement;
  /** Keys pressed together, such as `["Mod", "B"]`; none shows the label alone. */
  keys?: readonly string[];
  label: string;
  side?: ComponentProps<typeof TooltipContent>["side"];
}

/** A control's name on the left of its tooltip and its keys on the right. */
export function ShortcutTooltip({
  children,
  keys,
  label,
  side = "bottom",
}: ShortcutTooltipProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          className={cn("flex items-center", keys && "gap-2")}
          side={side}
        >
          {label}
          {keys && <ShortcutKeys keys={keys} />}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
