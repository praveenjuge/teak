import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { Button } from "@teak/ui/components/ui/button";
import { Card, CardContent } from "@teak/ui/components/ui/card";
import {
  CARD_LIMIT_TOAST_MESSAGE,
  MANUAL_CLOSE_TOAST_OPTIONS,
  TOAST_IDS,
} from "@teak/ui/constants/toast";
import { cn } from "@teak/ui/lib/utils";
import { MarkdownTextEditor } from "@teak/ui/text-editor";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "../../convexQueryHooks";
import {
  ariaKeyShortcut,
  clearNewNoteComposerFocusRequest,
  FULL_SCREEN_NOTE_KEYS,
  isNewNoteComposerFocusRequested,
  SAVE_NOTE_KEYS,
} from "../../lib/keyboardShortcuts";
import { FullScreenAddCardDialog } from "../lazyDialogs";
import {
  PRIMARY_BUTTON_KEYS_CLASS,
  ShortcutKeys,
  ShortcutTooltip,
} from "../shortcuts/ShortcutTooltip";
import { prepareNoteCapture } from "../text-editor/noteCapture";

function addCardToSearchQueries(
  localStore: OptimisticLocalStore,
  newCard: Doc<"cards">
) {
  const allQueries = localStore.getAllQueries(api.cards.searchCards);
  for (const { args, value } of allQueries) {
    if (value !== undefined && !args.showTrashOnly) {
      const hasVisualFilters =
        (args.styleFilters?.length ?? 0) > 0 ||
        (args.hueFilters?.length ?? 0) > 0 ||
        (args.hexFilters?.length ?? 0) > 0;
      if (hasVisualFilters) {
        continue;
      }

      const matchesType =
        !args.types ||
        args.types.length === 0 ||
        // The searched array (`args.types`) differs on every iteration and the
        // lookup key is constant, so a precomputed Set offers no benefit here.
        // react-doctor-disable-next-line react-doctor/js-set-map-lookups
        args.types.includes(newCard.type);
      const matchesFavorites = !args.favoritesOnly || newCard.isFavorited;

      if (matchesType && matchesFavorites) {
        localStore.setQuery(api.cards.searchCards, args, [newCard, ...value]);
      }
    }
  }
}

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
  onUpgrade,
  upgradeUrl = "/settings",
}: AddCardFormProps) {
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false);
  // `N` pressed away from Everything opens it and asks for the composer;
  // the request stands until the composer has focus (it can mount more
  // than once while the page loads).
  const [focusRequested] = useState(isNewNoteComposerFocusRequested);

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

  const cardCreationStatus = useQuery(api.auth.getCardCreationStatus);
  const canCreateCard =
    canCreateCardProp ?? cardCreationStatus?.canCreateCard ?? true;
  const basePlaceholderText = canCreateCard
    ? "Write a note..."
    : "Upgrade to Pro to add more cards...";
  const inlinePlaceholderText = basePlaceholderText;
  const fullScreenPlaceholderText = basePlaceholderText;
  const hasContent = Boolean(content.trim());
  const hasShownBlockedToastRef = useRef(false);

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

  // The draft clears as soon as a save starts, so another note can be written
  // and saved (button or Cmd/Ctrl+Enter) while earlier saves are in flight.
  const submitTextCard = async (): Promise<boolean> => {
    // Read the ref, not render state: it clears synchronously, so a repeated
    // shortcut or click can never submit the same note twice.
    const submittedContent = latestContentRef.current;
    if (!(submittedContent.trim() && canCreateCard)) {
      return false;
    }

    resetDraft();

    const toastId = toast.loading("Saving note...");
    captureEvent("card_create_submitted", {
      card_type: "text",
      source: "web",
      via: "text_form",
    });

    try {
      // Structured notes stay Markdown text; plain URL/color/quote captures
      // retain the server's existing automatic classification.
      await createCard({
        ...prepareNoteCapture(submittedContent),
        source: "web",
      });

      onSuccess?.();
      toast.success("Note saved", { id: toastId });
      return true;
    } catch (error) {
      console.error("Failed to create card:", error);

      // Put the unsaved note back without dropping anything typed since.
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
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitTextCard();
  };

  const handleFullScreenSave = async () => {
    setIsFullScreenOpen(false);
    await submitTextCard();
  };

  const requestFullScreenClose = () => {
    setIsFullScreenOpen(false);
  };

  return (
    <>
      <FullScreenAddCardDialog
        canCreateCard={canCreateCard}
        content={content}
        onContentChange={setContent}
        onRequestClose={requestFullScreenClose}
        onSave={handleFullScreenSave}
        open={isFullScreenOpen}
        placeholder={fullScreenPlaceholderText}
      />
      <Card
        className="group/composer relative min-h-36 w-full overflow-hidden p-0 shadow-none focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
        data-new-note-composer=""
        onFocus={clearNewNoteComposerFocusRequest}
      >
        {/* N focuses the composer from anywhere, like / for search. */}
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
              autoFocus={autoFocus || focusRequested}
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
                  setIsFullScreenOpen(true);
                }
              }}
              onSaveShortcut={() => {
                if (hasContent && canCreateCard) {
                  void submitTextCard();
                }
              }}
              placeholder={inlinePlaceholderText}
              value={content}
              variant="compact"
            />

            <div className="absolute right-3 bottom-3 flex justify-end gap-2">
              {hasContent && (
                <>
                  <ShortcutTooltip
                    keys={FULL_SCREEN_NOTE_KEYS}
                    label="Open full-screen note"
                  >
                    <Button
                      aria-keyshortcuts={ariaKeyShortcut(FULL_SCREEN_NOTE_KEYS)}
                      aria-label="Open full-screen note"
                      className="w-8 px-0"
                      disabled={!canCreateCard}
                      onClick={() => setIsFullScreenOpen(true)}
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
