"use client";

import { Fragment } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SHORTCUTS_DIALOG_ATTRIBUTE } from "../../hooks/useKeyboardShortcuts";
import {
  KEYBOARD_SHORTCUT_GROUPS,
  platformKey,
  type ShortcutRow,
} from "../../lib/keyboardShortcuts";
import { isApplePlatform } from "../../lib/platform";

interface KeyboardShortcutsDialogProps {
  onCloseAutoFocus?: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function KeyboardShortcutsDialog({
  open,
  onCloseAutoFocus,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-sm"
        onCloseAutoFocus={onCloseAutoFocus}
        {...{ [SHORTCUTS_DIALOG_ATTRIBUTE]: "" }}
      >
        <DialogHeader className="gap-1 border-b px-5 pt-5 pb-3 text-left">
          <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">
            Shortcuts work anywhere in your library, except while you type.
          </DialogDescription>
        </DialogHeader>
        {/* One list, each group's name staying in view while its rows scroll. */}
        <div className="min-h-0 overflow-y-auto px-5 pb-3">
          {KEYBOARD_SHORTCUT_GROUPS.map((group, index) => (
            <section
              aria-labelledby={`shortcut-group-${index}`}
              key={group.title}
            >
              <h3
                className="sticky top-0 z-10 bg-background pt-3 pb-1 font-medium text-muted-foreground text-xs"
                id={`shortcut-group-${index}`}
              >
                {group.title}
              </h3>
              <dl>
                {group.rows.map((row) => (
                  <div
                    className="flex h-7 items-center justify-between gap-3"
                    key={row.label}
                  >
                    <dt className="min-w-0 truncate text-[13px]">
                      {row.label}
                    </dt>
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

const KEY_NAMES: Record<string, string> = {
  "←": "Left arrow",
  "↑": "Up arrow",
  "→": "Right arrow",
  "↓": "Down arrow",
  "/": "Slash",
  "?": "Question mark",
  "⌥": "Option",
  "⌘": "Command",
  "⇧": "Shift",
  "↩": "Return",
};

export function shortcutAccessibleLabel(row: ShortcutRow): string {
  const names = row.keys.map((key) => KEY_NAMES[key] ?? key);
  if (row.combo) {
    return names.join(" plus ");
  }
  return names.join(row.sequence ? " then " : " or ");
}

export function ShortcutHint({ row }: { row: ShortcutRow }) {
  return <ShortcutKeys row={row} />;
}
