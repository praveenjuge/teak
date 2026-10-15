"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Kbd, KbdGroup } from "@teak/ui/components/ui/kbd";
import { Fragment } from "react";
import { SHORTCUTS_DIALOG_ATTRIBUTE } from "../../hooks/useKeyboardShortcuts";
import {
  KEYBOARD_SHORTCUT_GROUPS,
  type ShortcutRow,
} from "../../lib/keyboardShortcuts";
import { isApplePlatform } from "../../lib/platform";

interface KeyboardShortcutsDialogProps {
  /** Called as the dialog closes; preventing it keeps focus where it is. */
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/** Every keyboard shortcut, grouped, opened with `?`. */
export function KeyboardShortcutsDialog({
  open,
  onCloseAutoFocus,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-6rem)] gap-5 overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
        {...{ [SHORTCUTS_DIALOG_ATTRIBUTE]: "" }}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work anywhere in your library, except while you type.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {KEYBOARD_SHORTCUT_GROUPS.map((group, index) => (
            <section
              aria-labelledby={`shortcut-group-${index}`}
              className={index === 0 ? "sm:row-span-2" : undefined}
              key={group.title}
            >
              <h3
                className="mb-1.5 font-medium text-muted-foreground text-xs"
                id={`shortcut-group-${index}`}
              >
                {group.title}
              </h3>
              <dl className="divide-y divide-border/60">
                {group.rows.map((row) => (
                  <div
                    className="flex items-center justify-between gap-4 py-1.5"
                    key={row.label}
                  >
                    <dt className="text-sm">{row.label}</dt>
                    <dd className="shrink-0">
                      <ShortcutKeys row={row} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutKeys({ row }: { row: ShortcutRow }) {
  const apple = isApplePlatform();
  const shown = {
    ...row,
    keys: row.keys.map((key) => platformKey(key, apple)),
  };
  return (
    <KbdGroup>
      <span className="sr-only">{shortcutAccessibleLabel(shown)}</span>
      {shown.keys.map((key, index) => (
        <Fragment key={key}>
          {row.sequence && index > 0 && (
            <span aria-hidden="true" className="text-muted-foreground text-xs">
              then
            </span>
          )}
          <Kbd aria-hidden="true">{key}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}

/** `Mod` is Cmd on Apple platforms and Ctrl elsewhere; Alt is ⌥ on a Mac. */
function platformKey(key: string, apple: boolean): string {
  if (key === "Mod") {
    return apple ? "⌘" : "Ctrl";
  }
  return apple && key === "Alt" ? "⌥" : key;
}

const KEY_NAMES: Record<string, string> = {
  "←": "Left arrow",
  "↑": "Up arrow",
  "→": "Right arrow",
  "↓": "Down arrow",
  "/": "Slash",
  "?": "Question mark",
  "⌥": "Option",
  "⌘": "Command",
};

/** How a screen reader says the keys: "G then F", "J or K", "Alt plus T". */
export function shortcutAccessibleLabel(row: ShortcutRow): string {
  const names = row.keys.map((key) => KEY_NAMES[key] ?? key);
  if (row.combo) {
    return names.join(" plus ");
  }
  return names.join(row.sequence ? " then " : " or ");
}

/** A shortcut's keycaps, for a tooltip beside a label. */
export function ShortcutHint({ row }: { row: ShortcutRow }) {
  return <ShortcutKeys row={row} />;
}
