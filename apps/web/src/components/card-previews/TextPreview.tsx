import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Maximize2 } from "vadivam-react";
import { MarkdownTextEditor } from "@/components/text-editor";
import {
  ariaKeyShortcut,
  FOCUS_NOTE_KEYS,
  isFocusNoteKey,
} from "../../lib/keyboardShortcuts";
import type { GetCurrentValue } from "../card-modal/types";
import { FocusEditor } from "../lazyDialogs";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import type { CardLinkOptions } from "../text-editor/types";
import { useFocusMode } from "../text-editor/useFocusMode";
import { Button } from "../ui/button";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface TextPreviewProps {
  card: CardWithUrls;
  cardLinks?: CardLinkOptions;
  getCurrentValue?: GetCurrentValue;
  onContentChange: (content: string) => void;
  onSaveShortcut?: () => void;
  readOnly?: boolean;
}

/**
 * On a wide screen the note fills most of the stage; on a phone, where the
 * details stack under it, it is only as tall as its text (with room to tap),
 * so a one-line note doesn't push Notes and Tags off the screen.
 */
export const TEXT_PREVIEW_CLASS =
  "group/text-preview relative h-full max-md:[--teak-note-min-height:6rem]";
export const TEXT_PREVIEW_MIN_HEIGHT = "var(--teak-note-min-height, 55vh)";

export function TextPreview({
  card,
  cardLinks,
  onContentChange,
  getCurrentValue,
  onSaveShortcut,
  readOnly = false,
}: TextPreviewProps) {
  const t = useTranslations("cardPreviews.text");
  const tNote = useTranslations("textEditor.note");
  const currentContent = getCurrentValue
    ? getCurrentValue("content")
    : card.content;
  const {
    close: closeFocus,
    inlineEditorValue,
    isFocusOpen,
    open: openFocus,
  } = useFocusMode(currentContent || "");
  const isFocusOpenRef = useRef(false);
  isFocusOpenRef.current = isFocusOpen;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const focusButtonRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const openFocusRef = useRef(openFocus);
  openFocusRef.current = openFocus;
  useEffect(() => {
    const isInOwnDialog = (target: EventTarget | null) => {
      const ownDialog = wrapperRef.current?.closest("[role='dialog']");
      return (
        !ownDialog || (target instanceof Node && ownDialog.contains(target))
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isFocusOpenRef.current ||
        readOnlyRef.current ||
        !isFocusNoteKey(event) ||
        document.querySelector("[role='menu'][data-state='open']") ||
        !isInOwnDialog(event.target)
      ) {
        return;
      }
      event.preventDefault();
      openFocusRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={TEXT_PREVIEW_CLASS} ref={wrapperRef}>
      {readOnly ? null : (
        <ShortcutTooltip keys={FOCUS_NOTE_KEYS} label={t("focus")} side="left">
          <Button
            aria-keyshortcuts={ariaKeyShortcut(FOCUS_NOTE_KEYS)}
            aria-label={t("focus")}
            className="absolute top-2 right-2 z-10 size-8 text-muted-foreground"
            onClick={openFocus}
            ref={focusButtonRef}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Maximize2 className="size-4" />
          </Button>
        </ShortcutTooltip>
      )}
      <MarkdownTextEditor
        ariaLabel={tNote("contentLabel")}
        cardLinks={cardLinks}
        className="h-full"
        disabled={readOnly}
        minHeight={TEXT_PREVIEW_MIN_HEIGHT}
        onChange={onContentChange}
        onLimitExceeded={() => toast.error(tNote("tooLarge"))}
        onOpenFullScreen={readOnly ? undefined : openFocus}
        onSaveShortcut={onSaveShortcut}
        placeholder={t("placeholder")}
        value={inlineEditorValue}
        variant="modal"
      />
      <FocusEditor
        canSave
        cardLinks={cardLinks}
        fallbackFocusRef={focusButtonRef}
        onChange={onContentChange}
        onRequestClose={closeFocus}
        onSave={() => onSaveShortcut?.()}
        open={isFocusOpen}
        placeholder={tNote("placeholder")}
        title={t("focus")}
        value={currentContent || ""}
      />
    </div>
  );
}
