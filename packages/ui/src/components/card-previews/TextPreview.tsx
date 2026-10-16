import type { Doc } from "@teak/convex/_generated/dataModel";
import { MarkdownTextEditor } from "@teak/ui/text-editor";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ariaKeyShortcut,
  FOCUS_NOTE_KEYS,
  isFocusNoteKey,
} from "../../lib/keyboardShortcuts";
import type { GetCurrentValue } from "../card-modal/types";
import { FocusEditor } from "../lazyDialogs";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import { Button } from "../ui/button";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface TextPreviewProps {
  card: CardWithUrls;
  getCurrentValue?: GetCurrentValue;
  onContentChange: (content: string) => void;
  onSaveShortcut?: () => void;
}

export function TextPreview({
  card,
  onContentChange,
  getCurrentValue,
  onSaveShortcut,
}: TextPreviewProps) {
  const currentContent = getCurrentValue
    ? getCurrentValue("content")
    : card.content;
  const [isFocusOpen, setIsFocusOpen] = useState(false);
  // While Focus is open the editor underneath keeps the text it had: it is
  // hidden, and re-reading a long note on every key would slow typing in
  // Focus. It catches up once Focus closes.
  const [heldContent, setHeldContent] = useState<string | null>(null);
  const openFocus = () => {
    setHeldContent(currentContent || "");
    setIsFocusOpen(true);
  };
  const closeFocus = () => {
    setIsFocusOpen(false);
    setHeldContent(null);
  };
  const isFocusOpenRef = useRef(false);
  isFocusOpenRef.current = isFocusOpen;
  const focusButtonRef = useRef<HTMLButtonElement>(null);

  // ⌘E anywhere in the open card, not only in its editor (the editor's own
  // ⌘E opens Focus too, and prevents this one). An open menu keeps its keys;
  // the card's own dialog doesn't count, since this lives inside it.
  const openFocusRef = useRef(openFocus);
  openFocusRef.current = openFocus;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isFocusOpenRef.current ||
        !isFocusNoteKey(event) ||
        document.querySelector("[role='menu'][data-state='open']")
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
    <div className="group/text-preview relative h-full">
      <ShortcutTooltip keys={FOCUS_NOTE_KEYS} label="Focus" side="left">
        <Button
          aria-keyshortcuts={ariaKeyShortcut(FOCUS_NOTE_KEYS)}
          aria-label="Focus"
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
      <MarkdownTextEditor
        ariaLabel="Markdown content"
        className="h-full"
        minHeight="55vh"
        onChange={onContentChange}
        onLimitExceeded={() =>
          toast.error("Notes can be up to 512 KiB of UTF-8 text")
        }
        onOpenFullScreen={openFocus}
        onSaveShortcut={onSaveShortcut}
        placeholder="Write a note..."
        value={heldContent ?? currentContent ?? ""}
        variant="modal"
      />
      <FocusEditor
        canSave
        fallbackFocusRef={focusButtonRef}
        onChange={onContentChange}
        onRequestClose={closeFocus}
        onSave={() => onSaveShortcut?.()}
        open={isFocusOpen}
        placeholder="Write a note…"
        title="Focus"
        value={currentContent || ""}
      />
    </div>
  );
}
