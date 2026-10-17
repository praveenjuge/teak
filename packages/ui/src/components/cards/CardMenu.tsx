import type { ComponentProps, ComponentType, ReactNode } from "react";
import {
  ariaKeyShortcut,
  type MenuShortcut,
} from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export type CardMenuEntry =
  | "separator"
  | {
      destructive?: boolean;
      disabled?: boolean;
      icon: ComponentType<{ className?: string }>;
      iconClassName?: string;
      label: string;
      onSelect: () => void;
      shortcut?: MenuShortcut;
    };

type MenuItemComponent = ComponentType<{
  "aria-keyshortcuts"?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "default" | "destructive";
}>;

/**
 * A card's actions, rendered with the context menu's or the dropdown's own
 * item, separator and shortcut components so both menus list the same.
 */
export function CardMenuEntries({
  entries,
  Item,
  Separator,
  Shortcut,
}: {
  entries: CardMenuEntry[];
  Item: MenuItemComponent;
  Separator: ComponentType;
  Shortcut: ComponentType<{ "aria-hidden"?: boolean; children: ReactNode }>;
}) {
  return entries.map((entry, index) => {
    if (entry === "separator") {
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
      return <Separator key={`separator-${index}`} />;
    }
    const Icon = entry.icon;
    return (
      <Item
        aria-keyshortcuts={entry.shortcut?.keys}
        disabled={entry.disabled}
        key={entry.label}
        onClick={entry.onSelect}
        variant={entry.destructive ? "destructive" : "default"}
      >
        <Icon className={entry.iconClassName} />
        {entry.label}
        {entry.shortcut && (
          <Shortcut aria-hidden>{entry.shortcut.label}</Shortcut>
        )}
      </Item>
    );
  });
}

/** A round button in the card's hover actions. */
export function QuickActionButton({
  children,
  label,
  pressed,
  ref,
  shortcut,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  pressed?: boolean;
  /** Keys that do the same to a focused card, shown in the tooltip. */
  shortcut?: readonly string[];
}) {
  const button = (
    <button
      aria-keyshortcuts={shortcut ? ariaKeyShortcut(shortcut) : undefined}
      aria-label={label}
      aria-pressed={pressed}
      className="flex size-7 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm ring-1 ring-black/5 backdrop-blur-md transition-colors hover:bg-background data-[state=open]:bg-background dark:ring-white/10 [&_svg]:size-3.5 [&_svg]:opacity-80 [&_svg]:transition-opacity hover:[&_svg]:opacity-100"
      ref={ref}
      tabIndex={-1}
      title={shortcut ? undefined : label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
  return shortcut ? (
    <ShortcutTooltip keys={shortcut} label={label}>
      {button}
    </ShortcutTooltip>
  ) : (
    button
  );
}
