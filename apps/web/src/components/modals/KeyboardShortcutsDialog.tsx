"use client";

import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { Fragment, useMemo } from "react";
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
  keyboardShortcutGroups,
  platformKey,
  type ShortcutRow,
} from "../../lib/keyboardShortcuts";
import { isApplePlatform } from "../../lib/platform";
import { cn } from "../../lib/utils";

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
  const t = useTranslations("modals.shortcuts");
  const tShortcuts = useTranslations("shortcuts");
  const groups = useMemo(
    () => keyboardShortcutGroups(tShortcuts),
    [tShortcuts]
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-sm"
        onCloseAutoFocus={onCloseAutoFocus}
        {...{ [SHORTCUTS_DIALOG_ATTRIBUTE]: "" }}
      >
        <DialogHeader className="gap-1 border-b px-5 pt-5 pb-3 text-left">
          <DialogTitle className="text-base">{t("title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        {/* One list, each group's name staying in view while its rows scroll. */}
        <div className="min-h-0 overflow-y-auto px-5 pb-3">
          {groups.map((group, index) => (
            <section aria-labelledby={`shortcut-group-${index}`} key={group.id}>
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
                    key={row.id ?? row.label}
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
  const t = useTranslations("modals.shortcuts");
  const apple = isApplePlatform();
  const shown = {
    ...row,
    keys: row.keys.map((key) => platformKey(key, apple)),
  };
  return (
    <KbdGroup>
      <span className="sr-only">{shortcutAccessibleLabel(shown, t)}</span>
      {shown.keys.map((key, index) => (
        <Fragment key={key}>
          {row.sequence && index > 0 && (
            <span aria-hidden="true" className="text-muted-foreground text-xs">
              {t("then")}
            </span>
          )}
          <Kbd
            aria-hidden="true"
            className={cn(row.syntax && "font-mono tracking-normal")}
          >
            {key}
          </Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}

type ShortcutsTranslator = TeakTranslator<"modals.shortcuts">;
type KeyName = keyof typeof englishMessages.modals.shortcuts.keyNames;

const KEY_NAMES: Record<string, KeyName> = {
  "←": "leftArrow",
  "↑": "upArrow",
  "→": "rightArrow",
  "↓": "downArrow",
  "/": "slash",
  "?": "questionMark",
  "⌥": "option",
  "⌘": "command",
  "⇧": "shift",
  "↩": "return",
};

const englishShortcuts: ShortcutsTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "modals.shortcuts"
);

export function shortcutAccessibleLabel(
  row: ShortcutRow,
  t: ShortcutsTranslator = englishShortcuts
): string {
  if (row.syntax) {
    return t("typeKeys", { keys: row.keys.join(" ") });
  }
  const names = row.keys.map((key) => {
    const name = KEY_NAMES[key];
    return name ? t(`keyNames.${name}`) : key;
  });
  if (row.combo) {
    return names.join(t("comboSeparator"));
  }
  return names.join(
    row.sequence ? t("sequenceSeparator") : t("alternativeSeparator")
  );
}

export function ShortcutHint({ row }: { row: ShortcutRow }) {
  return <ShortcutKeys row={row} />;
}
