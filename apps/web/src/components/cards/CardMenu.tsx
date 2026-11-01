import type {
  ComponentProps,
  ComponentType,
  KeyboardEvent,
  ReactNode,
} from "react";
import {
  ariaKeyShortcut,
  type MenuShortcut,
  matchesMenuShortcut,
} from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export type CardMenuEntry =
  | { separator: string }
  | {
      destructive?: boolean;
      disabled?: boolean;
      icon: ComponentType<{ className?: string }>;
      iconClassName?: string;
      /** Stable across languages, unlike the label. */
      id: string;
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
  return entries.map((entry) => {
    if ("separator" in entry) {
      return <Separator key={`separator-${entry.separator}`} />;
    }
    const Icon = entry.icon;
    return (
      <Item
        aria-keyshortcuts={entry.shortcut?.keys}
        disabled={entry.disabled}
        key={entry.id}
        onClick={entry.onSelect}
        variant={entry.destructive ? "destructive" : "default"}
      >
        <Icon className={entry.iconClassName} />
        {entry.label}
        {entry.shortcut ? (
          <Shortcut aria-hidden>{entry.shortcut.label}</Shortcut>
        ) : null}
      </Item>
    );
  });
}

/**
 * An open menu takes focus from the card, so the card grid never hears the
 * shortcuts the menu lists. Give the menu its own: a key that matches an
 * item's shortcut picks that item, which runs it and closes the menu.
 */
export function handleCardMenuShortcut(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented) {
    return;
  }
  const item = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitem"][aria-keyshortcuts]'
    )
  ).find((candidate) =>
    matchesMenuShortcut(
      candidate.getAttribute("aria-keyshortcuts") ?? "",
      event
    )
  );
  if (!item) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!(event.repeat || item.hasAttribute("data-disabled"))) {
    item.click();
  }
}

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
