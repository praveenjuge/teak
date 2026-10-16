"use client";

import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
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
import { countWords, formatWordCount } from "./wordCount";

/**
 * Whether Esc belongs to something open in the editor rather than to Focus:
 * the slash menu, or the formatting toolbar's link editor. Radix sees Esc
 * before them (it listens on the document), so Focus has to step aside.
 */
export function editorPopupOwnsEscape(
  dialog: ParentNode,
  active: Element | null
): boolean {
  return (
    dialog.querySelector(
      "[role='listbox'][aria-label='Formatting commands']"
    ) !== null || Boolean(active?.closest(".teak-editor-formatting"))
  );
}

/** How long typing pauses before the word count shows. */
export const WORD_COUNT_IDLE_MS = 1000;

export interface FocusEditorProps {
  canSave: boolean;
  disabled?: boolean;
  /** Takes focus on leaving when nothing had it on entering (⌘E on the page). */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onChange: (value: string) => void;
  /** Leaves Focus: Esc, Close, or ⌘E again. Edits are kept. */
  onRequestClose: () => void;
  onSave: () => void | Promise<void>;
  open: boolean;
  placeholder: string;
  saveLabel?: string;
  /** For screen readers: what is being written. */
  title: string;
  value: string;
}

/**
 * Writing with nothing else on screen: one centered column, a Close and
 * Save bar that fades out while you type, and a word count once you pause.
 * New notes (the composer) and existing ones (the card dialog) share it,
 * and ⌘E (Ctrl+E) enters and leaves it.
 */
export function FocusEditor({
  canSave,
  disabled,
  fallbackFocusRef,
  onChange,
  onRequestClose,
  onSave,
  open,
  placeholder,
  saveLabel = "Save",
  title,
  value,
}: FocusEditorProps) {
  const [isTyping, setIsTyping] = useState(false);
  // The last count stays as it fades out; a pause shows a fresh one.
  const [wordCount, setWordCount] = useState(0);
  const [isCountShown, setIsCountShown] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // Radix gives focus back to a dialog's trigger, and Focus has none, so
  // remember what had it as Focus opens and return there on leaving.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    const focused = document.activeElement;
    returnFocusRef.current =
      focused instanceof HTMLElement && focused !== document.body
        ? focused
        : null;
  }
  wasOpenRef.current = open;

  // The count is worked out only once typing pauses, so a long note costs
  // nothing per keystroke.
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
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current?.isConnected
            ? returnFocusRef.current
            : fallbackFocusRef?.current;
          if (target) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}
        onEscapeKeyDown={(event) => {
          // The slash menu and the link editor close themselves on Esc.
          const dialog = contentRef.current;
          if (dialog && editorPopupOwnsEscape(dialog, document.activeElement)) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          // ⌘E leaves from anywhere in Focus, Close and Save included; the
          // editor handles (and prevents) its own.
          if (!event.defaultPrevented && isFocusNoteKey(event.nativeEvent)) {
            event.preventDefault();
            onRequestClose();
            return;
          }
          // A key outside the editor (Tab to the buttons, say) brings the
          // bar back; typing in the editor keeps it hidden.
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
          Focus mode: only the note is on screen. Press Escape to leave.
        </DialogDescription>

        <div className="relative flex h-dvh w-full flex-col">
          <div
            className={cn(
              "absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-background/90 px-4 py-2 backdrop-blur transition-opacity duration-200 ease-out sm:px-6",
              // Faded, the strip lets clicks through to the note, but its
              // buttons still work for a click that comes without a hover.
              isTyping &&
                "pointer-events-none opacity-0 [&_button]:pointer-events-auto"
            )}
            data-focus-chrome={isTyping ? "hidden" : "visible"}
          >
            <Button
              aria-keyshortcuts="Escape"
              onClick={onRequestClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Close
              <ShortcutKeys className="max-sm:hidden" keys={["Esc"]} />
            </Button>
            <Button
              aria-keyshortcuts={ariaKeyShortcut(SAVE_NOTE_KEYS)}
              disabled={!canSave}
              onClick={saveIfAllowed}
              size="sm"
              type="button"
            >
              {saveLabel}
              <ShortcutKeys
                className={PRIMARY_BUTTON_KEYS_CLASS}
                keys={SAVE_NOTE_KEYS}
              />
            </Button>
          </div>

          <MarkdownTextEditor
            ariaLabel="Markdown content"
            autoFocus
            className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-4 pt-14 pb-16 sm:px-6"
            disabled={disabled}
            minHeight="60vh"
            onChange={handleChange}
            onLimitExceeded={() =>
              toast.error("Notes can be up to 512 KiB of UTF-8 text")
            }
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
            {formatWordCount(wordCount)}
          </output>
        </div>
      </DialogContent>
    </Dialog>
  );
}
