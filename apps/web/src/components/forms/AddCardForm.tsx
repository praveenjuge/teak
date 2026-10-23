import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { useMutation } from "convex/react";
import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownTextEditor } from "@/components/text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CARD_LIMIT_TOAST_MESSAGE,
  MANUAL_CLOSE_TOAST_OPTIONS,
  TOAST_IDS,
} from "@/constants/toast";
import { useGlobalFileDrop } from "@/hooks";
import { cn } from "@/lib/utils";
import { useCardLinkEditor } from "../../hooks/useCardLinkEditor";
import { useWarnBeforeUnload } from "../../hooks/useWarnBeforeUnload";
import { addCardToSearchQueries } from "../../lib/cardQueryOptimisticUpdates";
import { useQuery } from "../../lib/convexQueryHooks";
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
import {
  noteCaptureSavedMessage,
  prepareNoteCapture,
} from "../text-editor/noteCapture";
import { useFocusMode } from "../text-editor/useFocusMode";

function getCardErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") {
    return null;
  }

  const maybeError = err as {
    code?: string;
    message?: string;
    data?: { code?: string };
  };

  if (
    maybeError.code &&
    Object.values(CARD_ERROR_CODES).includes(
      maybeError.code as (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES]
    )
  ) {
    return maybeError.code;
  }

  if (
    maybeError.data?.code &&
    Object.values(CARD_ERROR_CODES).includes(
      maybeError.data
        .code as (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES]
    )
  ) {
    return maybeError.data.code;
  }

  return null;
}

function isCardLimitError(err: unknown): boolean {
  return getCardErrorCode(err) === CARD_ERROR_CODES.CARD_LIMIT_REACHED;
}

function isRateLimitError(err: unknown): boolean {
  return getCardErrorCode(err) === CARD_ERROR_CODES.RATE_LIMITED;
}

export interface AddCardFormProps {
  autoFocus?: boolean;
  canCreateCard?: boolean;
  draftContentRef?: React.MutableRefObject<string>;
  onFocus?: () => void;
  /** Opens a card linked with `[[…]]` from the note being written. */
  onOpenCard?: (cardId: string) => void;
  onSuccess?: () => void;
  onUpgrade?: () => void;
  UpgradeLinkComponent?: React.ComponentType<{
    href: string;
    children: React.ReactNode;
    className?: string;
  }>;
  upgradeUrl?: string;
}

export function AddCardForm({
  onSuccess,
  autoFocus,
  canCreateCard: canCreateCardProp,
  draftContentRef,
  onFocus,
  onOpenCard,
  onUpgrade,
  upgradeUrl = "/settings",
}: AddCardFormProps) {
  const [content, setInternalContent] = useState(
    () => draftContentRef?.current ?? ""
  );
  const latestContentRef = useRef(content);
  const setContent = useCallback(
    (nextContent: string) => {
      latestContentRef.current = nextContent;
      setInternalContent(nextContent);
      if (draftContentRef) {
        draftContentRef.current = nextContent;
      }
    },
    [draftContentRef]
  );
  const {
    close: closeFocus,
    inlineEditorValue,
    isFocusOpen,
    open: openFocus,
  } = useFocusMode(content);

  const globalFileDrop = useGlobalFileDrop();
  const cardCreationStatus = useQuery(api.auth.getCardCreationStatus);
  const canCreateCard =
    canCreateCardProp ?? cardCreationStatus?.canCreateCard ?? true;
  const basePlaceholderText = canCreateCard
    ? "Write a note..."
    : "Upgrade to Pro to add more cards...";
  const inlinePlaceholderText = basePlaceholderText;
  const focusPlaceholderText = basePlaceholderText;
  const hasContent = Boolean(content.trim());
  const cardLinks = useCardLinkEditor({ onOpenCard, value: content });
  const hasShownBlockedToastRef = useRef<boolean>(false);

  const handleUpgrade = useCallback(() => {
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    window.location.assign(upgradeUrl);
  }, [onUpgrade, upgradeUrl]);

  const showUpgradeToast = useCallback(
    (toastId: string | number = TOAST_IDS.cardLimit) => {
      toast.error(CARD_LIMIT_TOAST_MESSAGE, {
        ...MANUAL_CLOSE_TOAST_OPTIONS,
        action: {
          label: "Upgrade",
          onClick: handleUpgrade,
        },
        id: toastId,
      });
    },
    [handleUpgrade]
  );

  useEffect(() => {
    if (cardCreationStatus?.canCreateCard === false) {
      if (!hasShownBlockedToastRef.current) {
        showUpgradeToast();
        hasShownBlockedToastRef.current = true;
      }
      return;
    }

    hasShownBlockedToastRef.current = false;
  }, [cardCreationStatus?.canCreateCard, showUpgradeToast]);

  const createCard = useMutation(api.cards.createCard).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const submittedContent = args.content ?? "";

      const optimisticCard: Doc<"cards"> = {
        _id: crypto.randomUUID() as Id<"cards">,
        _creationTime: now,
        userId: "",
        content: submittedContent,
        type: "text",
        createdAt: now,
        updatedAt: now,
      };

      addCardToSearchQueries(localStore, optimisticCard);
    }
  );

  const resetDraft = () => {
    setContent("");
  };

  // The draft is cleared as a note is sent, so until the server has it,
  // closing the tab would lose it.
  const [savingNotes, setSavingNotes] = useState(0);
  useWarnBeforeUnload(savingNotes > 0);

  const submitTextCard = async (): Promise<boolean> => {
    const submittedContent = latestContentRef.current;
    if (!(submittedContent.trim() && canCreateCard)) {
      return false;
    }

    resetDraft();

    const toastId = toast.loading("Saving…");
    captureEvent("card_create_submitted", {
      card_type: "text",
      source: "web",
      via: "text_form",
    });

    setSavingNotes((count) => count + 1);
    try {
      const capture = prepareNoteCapture(submittedContent);
      await createCard({ ...capture, source: "web" });

      onSuccess?.();
      toast.success(noteCaptureSavedMessage(capture), { id: toastId });
      return true;
    } catch (error) {
      console.error("Failed to create card:", error);

      const newerDraft = latestContentRef.current;
      setContent(
        newerDraft.trim()
          ? `${submittedContent}\n\n${newerDraft}`
          : submittedContent
      );

      const errorMessage =
        error instanceof Error ? error.message : "Failed to save note";

      if (isCardLimitError(error)) {
        showUpgradeToast(toastId);
      } else if (isRateLimitError(error)) {
        toast.error("Too many cards created. Please wait a moment.", {
          id: toastId,
        });
      } else {
        toast.error(errorMessage, { id: toastId });
      }
      return false;
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
        canSave={Boolean(content.trim() && canCreateCard)}
        cardLinks={cardLinks}
        disabled={!canCreateCard}
        onChange={setContent}
        onRequestClose={closeFocus}
        onSave={handleFocusSave}
        open={isFocusOpen}
        placeholder={focusPlaceholderText}
        title="Focus"
        value={content}
      />
      <Card
        className="group/composer relative min-h-36 w-full overflow-hidden p-0 shadow-none focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
        data-new-note-composer=""
        onFocus={onFocus}
      >
        {!hasContent && (
          <ShortcutKeys
            className="pointer-events-none absolute top-3 right-3 group-focus-within/composer:hidden max-sm:hidden"
            keys={["N"]}
          />
        )}
        <CardContent className="h-full p-0">
          <form
            className="relative flex min-h-36 flex-1 flex-col"
            data-card-creation-status={
              cardCreationStatus === undefined ? "loading" : "ready"
            }
            onSubmit={handleTextSubmit}
          >
            <MarkdownTextEditor
              ariaLabel="Markdown content"
              autoFocus={autoFocus}
              cardLinks={cardLinks}
              className={cn(
                "h-full min-h-20 flex-1 p-2",
                hasContent && "pb-12"
              )}
              disabled={!canCreateCard}
              minHeight="5rem"
              onChange={setContent}
              onLimitExceeded={() =>
                toast.error("Notes can be up to 512 KiB of UTF-8 text")
              }
              onOpenFullScreen={() => {
                if (canCreateCard) {
                  openFocus();
                }
              }}
              onPasteFiles={globalFileDrop?.enqueueFiles}
              onSaveShortcut={() => {
                if (hasContent && canCreateCard) {
                  void submitTextCard();
                }
              }}
              placeholder={inlinePlaceholderText}
              value={inlineEditorValue}
              variant="compact"
            />

            <div className="absolute right-3 bottom-3 flex justify-end gap-2">
              {hasContent && (
                <>
                  <ShortcutTooltip keys={FOCUS_NOTE_KEYS} label="Focus">
                    <Button
                      aria-keyshortcuts={ariaKeyShortcut(FOCUS_NOTE_KEYS)}
                      aria-label="Focus"
                      className="w-8 px-0"
                      disabled={!canCreateCard}
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
                    disabled={!canCreateCard}
                    size="sm"
                    type="submit"
                  >
                    Save
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
