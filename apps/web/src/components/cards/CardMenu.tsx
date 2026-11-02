import type { ComponentProps, ComponentType, ReactNode } from "react";
import {
  ariaKeyShortcut,
  type MenuShortcut,
} from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export type CardMenuEntry =
  | { separator: string }
  | {
      destructive?: boolean;
      disabled?: boolean;
      icon: ComponentType<{ className?: string }>;
      iconClassName?: string;
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
  Shortcut: ComponentType<{
    "aria-hidden"?: boolean;
    children: ReactNode;
    className?: string;
  }>;
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
          // Key hints mean nothing without a keyboard.
          <Shortcut aria-hidden className="pointer-coarse:hidden">
            {entry.shortcut.label}
          </Shortcut>
        ) : null}
      </Item>
    );
  });
}

export function QuickActionButton({
  children,
  className,
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
      className={cn(
        "flex size-7 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm ring-1 ring-black/5 backdrop-blur-md transition-colors hover:bg-background data-[state=open]:bg-background dark:ring-white/10 [&_svg]:size-3.5 [&_svg]:opacity-80 [&_svg]:transition-opacity hover:[&_svg]:opacity-100",
        className
      )}
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
