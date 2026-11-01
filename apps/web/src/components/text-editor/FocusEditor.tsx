"use client";

import { useTranslations } from "@teak/i18n/react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReturnFocus } from "../../hooks/useReturnFocus";
import {
  ariaKeyShortcut,
  isFocusNoteKey,
  SAVE_NOTE_KEYS,
} from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";
import {
  PRIMARY_BUTTON_KEYS_CLASS,
  ShortcutKeys,
} from "../shortcuts/ShortcutTooltip";
import { MarkdownTextEditor } from "./MarkdownTextEditor";
import type { CardLinkOptions } from "./types";
import { countWords, formatWordCount } from "./wordCount";

/**
 * Radix sees Esc before the slash menu and the link editor (it listens
 * on the document), so Focus steps aside while one of them is open.
 */
export function editorPopupOwnsEscape(
  dialog: ParentNode,
  active: Element | null
): boolean {
  return (
    dialog.querySelector("[role='listbox'][data-editor-popup]") !== null ||
    Boolean(active?.closest(".teak-editor-formatting"))
  );
}

export const WORD_COUNT_IDLE_MS = 1000;

export interface FocusEditorProps {
  canSave: boolean;
  cardLinks?: CardLinkOptions;
  disabled?: boolean;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onChange: (value: string) => void;
  onRequestClose: () => void;
  onSave: () => void | Promise<void>;
  open: boolean;
  placeholder: string;
  saveLabel?: string;
  title: string;
  value: string;
}

export function FocusEditor({
  canSave,
  cardLinks,
  disabled,
  fallbackFocusRef,
  onChange,
  onRequestClose,
  onSave,
  open,
  placeholder,
  saveLabel,
  title,
  value,
}: FocusEditorProps) {
  const t = useTranslations("textEditor");
  const tc = useTranslations("common");
  const [isTyping, setIsTyping] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [isCountShown, setIsCountShown] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const returnFocus = useReturnFocus(open);
  const contentRef = useRef<HTMLDivElement>(null);

  const scheduleWordCount = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      setWordCount(countWords(valueRef.current));
      setIsCountShown(true);
    }, WORD_COUNT_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!open) {
      setIsTyping(false);
      setIsCountShown(false);
      return;
    }
    scheduleWordCount();
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [open, scheduleWordCount]);

  const handleChange = (next: string) => {
    setIsTyping(true);
    setIsCountShown(false);
    scheduleWordCount();
    onChange(next);
  };

  const showChrome = () => setIsTyping(false);
  const saveIfAllowed = () => {
    if (canSave) {
      void onSave();
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onRequestClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="fixed top-0 left-0 h-dvh w-dvw max-w-none translate-x-0! translate-y-0! transform-none overscroll-contain rounded-none! border-0 p-0 shadow-none sm:max-w-none"
        data-focus-editor=""
        onCloseAutoFocus={(event) =>
          returnFocus(event, fallbackFocusRef?.current)
        }
        onEscapeKeyDown={(event) => {
          const dialog = contentRef.current;
          if (dialog && editorPopupOwnsEscape(dialog, document.activeElement)) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if (!event.defaultPrevented && isFocusNoteKey(event.nativeEvent)) {
            event.preventDefault();
            onRequestClose();
            return;
          }
          const target = event.target as HTMLElement | null;
          if (!target?.closest("[contenteditable='true'], textarea")) {
            showChrome();
          }
        }}
        onPointerMove={showChrome}
        ref={contentRef}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("focus.description")}
        </DialogDescription>

        <div className="relative flex h-dvh w-full flex-col">
          <div
            className={cn(
              "absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-background/90 px-4 py-2 backdrop-blur transition-opacity duration-200 ease-out sm:px-6",
              isTyping &&
                "pointer-events-none opacity-0 [&_button]:pointer-events-auto"
            )}
            data-editor-avoid=""
            data-focus-chrome={isTyping ? "hidden" : "visible"}
          >
            <Button
              aria-keyshortcuts="Escape"
              onClick={onRequestClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              {tc("close")}
              <ShortcutKeys className="max-sm:hidden" keys={["Esc"]} />
            </Button>
            <Button
              aria-keyshortcuts={ariaKeyShortcut(SAVE_NOTE_KEYS)}
              disabled={!canSave}
              onClick={saveIfAllowed}
              size="sm"
              type="button"
            >
              {saveLabel ?? tc("save")}
              <ShortcutKeys
                className={PRIMARY_BUTTON_KEYS_CLASS}
                keys={SAVE_NOTE_KEYS}
              />
            </Button>
          </div>

          <MarkdownTextEditor
            ariaLabel={t("note.contentLabel")}
            autoFocus
            cardLinks={cardLinks}
            className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-4 pt-14 pb-16 sm:px-6"
            disabled={disabled}
            minHeight="60vh"
            onChange={handleChange}
            onLimitExceeded={() => toast.error(t("note.tooLarge"))}
            onOpenFullScreen={onRequestClose}
            onSaveShortcut={saveIfAllowed}
            placeholder={placeholder}
            value={value}
          />

          <output
            aria-live="off"
            className={cn(
              "pointer-events-none absolute right-4 bottom-3 text-muted-foreground text-xs tabular-nums transition-opacity duration-200 ease-out sm:right-6",
              isCountShown ? "opacity-100" : "opacity-0"
            )}
            data-word-count={isCountShown ? "shown" : "hidden"}
          >
            {formatWordCount(wordCount, t)}
          </output>
        </div>
      </DialogContent>
    </Dialog>
  );
}
