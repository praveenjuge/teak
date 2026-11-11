import { api } from "@teak/convex";
import { captureEvent } from "@teak/convex/shared/analytics";
import {
  LINK_PASTE_ACTIVE_CODE,
  LINK_PASTE_LIMIT,
  LINK_PASTE_MAX_INPUT,
} from "@teak/convex/shared/constants";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Maximize2 } from "vadivam-react";
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { MarkdownTextEditor } from "@/components/text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useUpgradeAction } from "@/hooks/useUpgradeAction";
import { NEW_NOTE_COMPOSER_ATTRIBUTE } from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import { useCanCreateCard } from "../../hooks/useCanCreateCard";
import { useCardLinkEditor } from "../../hooks/useCardLinkEditor";
import { useWarnBeforeUnload } from "../../hooks/useWarnBeforeUnload";
import {
  ariaKeyShortcut,
  FOCUS_NOTE_KEYS,
  SAVE_NOTE_KEYS,
} from "../../lib/keyboardShortcuts";
import { FocusEditor } from "../lazyDialogs";
import {
  PRIMARY_BUTTON_KEYS_CLASS,
  ShortcutKeys,
  ShortcutTooltip,
} from "../shortcuts/ShortcutTooltip";
import { extractLinkList } from "../text-editor/noteCapture";
import { useFocusMode } from "../text-editor/useFocusMode";
import { useComposer } from "./ComposerProvider";
import { useSaveNote } from "./useSaveNote";

function isPasteActiveError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { data?: { code?: unknown } }).data?.code === LINK_PASTE_ACTIVE_CODE
  );
}

export interface AddCardFormProps {
  /** Focus on mount; the composer also takes a pending new-note request. */
  autoFocus?: boolean;
  onOpenCard?: (cardId: string) => void;
  onSuccess?: () => void;
}

export function AddCardForm({
  onSuccess,
  autoFocus = false,
  onOpenCard,
}: AddCardFormProps) {
  const t = useTranslations("forms.addCard");
  const tPaste = useTranslations("forms.pasteLinks");
  const tEditor = useTranslations("textEditor");
  const tc = useTranslations("common");
  const {
    addPasteJob,
    content,
    draftStored,
    focusHandled,
    focusPending,
    latestContent,
    pasteInProgress,
    pasteReachedLimit,
    setContent,
  } = useComposer();
  const {
    close: closeFocus,
    inlineEditorValue,
    isFocusOpen,
    open: openFocus,
  } = useFocusMode(content);

  const globalFileDrop = useGlobalFileDrop();
  const accountCanCreateCard = useCanCreateCard();
  const canCreateCard = accountCanCreateCard ?? true;
  const basePlaceholderText = canCreateCard
    ? t("placeholder")
    : t("upgradePlaceholder");
  const inlinePlaceholderText = basePlaceholderText;
  const focusPlaceholderText = basePlaceholderText;
  const hasContent = Boolean(content.trim());
  const linkList = useMemo(() => extractLinkList(content), [content]);
  let saveLabel = tc("save");
  if (linkList && linkList.length > LINK_PASTE_LIMIT) {
    saveLabel = t("saveFirstLinks", { count: LINK_PASTE_LIMIT });
  } else if (linkList) {
    saveLabel = t("saveLinks", { count: linkList.length });
  }
  const cardLinks = useCardLinkEditor({ onOpenCard, value: content });
  const hasShownBlockedToastRef = useRef<boolean>(false);

  const { showUpgradeToast } = useUpgradeAction();

  useEffect(() => {
    if (accountCanCreateCard === false) {
      // Wait for a paste to finish, so its toast can say it first. A paste
      // that stopped at the limit already said so.
      if (!(hasShownBlockedToastRef.current || pasteInProgress)) {
        if (!pasteReachedLimit) {
          showUpgradeToast();
        }
        hasShownBlockedToastRef.current = true;
      }
      return;
    }

    hasShownBlockedToastRef.current = false;
  }, [
    accountCanCreateCard,
    pasteInProgress,
    pasteReachedLimit,
    showUpgradeToast,
  ]);

  const { saveNote } = useSaveNote({ onOpenCard, onSuccess });
  const startLinkPaste = useMutation(api.card.pasteLinks.startLinkPaste);

  const resetDraft = () => {
    setContent("");
  };

  const restoreDraft = (submittedContent: string) => {
    const newerDraft = latestContent();
    setContent(
      newerDraft.trim()
        ? `${submittedContent}\n\n${newerDraft}`
        : submittedContent
    );
  };

  const [savingNotes, setSavingNotes] = useState(0);
  useWarnBeforeUnload(savingNotes > 0 || (hasContent && !draftStored));

  const submitLinkList = async (
    submittedContent: string,
    links: string[]
  ): Promise<boolean> => {
    resetDraft();
    const urls = links.slice(0, LINK_PASTE_MAX_INPUT);
    const toastId = toast.loading(
      tPaste("progress", {
        done: 0,
        total: Math.min(links.length, LINK_PASTE_LIMIT),
      })
    );
    captureEvent("card_create_submitted", {
      card_type: "link",
      source: "web",
      via: "link_paste",
    });

    setSavingNotes((count) => count + 1);
    try {
      const { jobId } = await startLinkPaste({ urls });
      onSuccess?.();
      addPasteJob({
        extraOmitted: links.length - urls.length,
        jobId,
        toastId,
      });
      return true;
    } catch (error) {
      console.error("Failed to start saving links:", error);
      restoreDraft(submittedContent);
      toast.error(
        isPasteActiveError(error) ? tPaste("active") : tPaste("failed"),
        { id: toastId }
      );
      return false;
    } finally {
      setSavingNotes((count) => count - 1);
    }
  };

  const submitTextCard = async (): Promise<boolean> => {
    const submittedContent = latestContent();
    if (!submittedContent.trim()) {
      return false;
    }
    const links = extractLinkList(submittedContent);
    if (links) {
      return await submitLinkList(submittedContent, links);
    }
    if (!canCreateCard) {
      showUpgradeToast();
      return false;
    }

    resetDraft();
    setSavingNotes((count) => count + 1);
    try {
      return await saveNote(submittedContent, {
        onNotSaved: () => restoreDraft(submittedContent),
        onRestored: () => {
          if (latestContent().trim() === submittedContent.trim()) {
            resetDraft();
          }
        },
      });
    } finally {
      setSavingNotes((count) => count - 1);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitTextCard();
  };

  const handleFocusSave = async () => {
    closeFocus();
    await submitTextCard();
  };

  return (
    <>
      <FocusEditor
        canSave={Boolean(content.trim())}
        cardLinks={cardLinks}
        onChange={setContent}
        onRequestClose={closeFocus}
        onSave={handleFocusSave}
        open={isFocusOpen}
        placeholder={focusPlaceholderText}
        saveLabel={saveLabel}
        title={t("focus")}
        value={content}
      />
      <Card
        className="group/composer relative min-h-36 w-full overflow-hidden p-0 shadow-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        {...{ [NEW_NOTE_COMPOSER_ATTRIBUTE]: "" }}
        onFocus={focusHandled}
      >
        {!hasContent && (
          <ShortcutKeys
            className="pointer-events-none absolute top-3 right-3 pointer-coarse:hidden group-focus-within/composer:hidden max-sm:hidden"
            keys={["N"]}
          />
        )}
        <CardContent className="h-full p-0">
          <form
            className="relative flex min-h-36 flex-1 flex-col"
            data-card-creation-status={
              accountCanCreateCard === undefined ? "loading" : "ready"
            }
            onSubmit={handleTextSubmit}
          >
            <MarkdownTextEditor
              ariaLabel={tEditor("note.contentLabel")}
              autoFocus={autoFocus || focusPending}
              blurOnEscape
              cardLinks={cardLinks}
              className={cn(
                "h-full min-h-20 flex-1 p-2",
                hasContent && "pb-12"
              )}
              minHeight="5rem"
              onChange={setContent}
              onLimitExceeded={() => toast.error(tEditor("note.tooLarge"))}
              onOpenFullScreen={openFocus}
              onPasteFiles={globalFileDrop?.enqueueFiles}
              onSaveShortcut={() => {
                if (hasContent) {
                  void submitTextCard();
                }
              }}
              placeholder={inlinePlaceholderText}
              value={inlineEditorValue}
              variant="compact"
            />

            <div
              className="absolute right-3 bottom-3 flex justify-end gap-2"
              data-editor-avoid=""
            >
              {hasContent && (
                <>
                  <ShortcutTooltip keys={FOCUS_NOTE_KEYS} label={t("focus")}>
                    <Button
                      aria-keyshortcuts={ariaKeyShortcut(FOCUS_NOTE_KEYS)}
                      aria-label={t("focus")}
                      className="w-8 px-0"
                      onClick={openFocus}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Maximize2 className="size-4" />
                    </Button>
                  </ShortcutTooltip>
                  <Button
                    aria-keyshortcuts={ariaKeyShortcut(SAVE_NOTE_KEYS)}
                    size="sm"
                    type="submit"
                  >
                    {saveLabel}
                    <ShortcutKeys
                      className={PRIMARY_BUTTON_KEYS_CLASS}
                      keys={SAVE_NOTE_KEYS}
                    />
                  </Button>
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
