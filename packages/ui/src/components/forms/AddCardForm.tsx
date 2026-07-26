import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { trackCardCreateAttempt } from "@teak/convex/shared/metrics";
import { Button } from "@teak/ui/components/ui/button";
import { Card, CardContent } from "@teak/ui/components/ui/card";
import { Textarea } from "@teak/ui/components/ui/textarea";
import {
  MANUAL_CLOSE_TOAST_OPTIONS,
  TOAST_IDS,
} from "@teak/ui/constants/toast";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "../../convexQueryHooks";
import { FullScreenAddCardDialog } from "./FullScreenAddCardDialog";

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
  onUpgrade,
  upgradeUrl = "/settings",
}: AddCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false);

  const [content, setContent] = useState("");

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
      toast.error(
        "You've reached your free tier limit. Upgrade to Pro for unlimited cards.",
        {
          ...MANUAL_CLOSE_TOAST_OPTIONS,
          action: {
            label: "Upgrade",
            onClick: handleUpgrade,
          },
          id: toastId,
        }
      );
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetDraft = () => {
    setContent("");
  };

  const submitTextCard = async (): Promise<boolean> => {
    if (!(content.trim() && canCreateCard) || isSubmitting) {
      return false;
    }

    const submittedContent = content;
    resetDraft();

    const toastId = toast.loading("Saving note...");
    setIsSubmitting(true);
    trackCardCreateAttempt({
      cardType: "text",
      source: "web",
      via: "text_form",
    });

    try {
      // Intentionally omit `type` so the server auto-classifies the note.
      // Passing an explicit type skips classification, which would stop colors
      // from becoming palette cards (and quotes/links from being detected).
      await createCard({
        content: submittedContent,
      });

      onSuccess?.();
      toast.success("Note saved", { id: toastId });
      return true;
    } catch (error) {
      console.error("Failed to create card:", error);

      setContent(submittedContent);

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
      setIsSubmitting(false);
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

  const handleFullScreenShortcut = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    const isShortcut =
      (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e";
    if (!isShortcut) {
      return false;
    }
    if (!canCreateCard) {
      return false;
    }
    event.preventDefault();
    setIsFullScreenOpen(true);
    return true;
  };

  return (
    <>
      <FullScreenAddCardDialog
        canCreateCard={canCreateCard}
        content={content}
        isSubmitting={isSubmitting}
        onContentChange={setContent}
        onRequestClose={requestFullScreenClose}
        onSave={handleFullScreenSave}
        open={isFullScreenOpen}
        placeholder={fullScreenPlaceholderText}
      />
      <Card className="min-h-36 w-full overflow-hidden p-0 shadow-none focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        <CardContent className="h-full p-0">
          <form
            className="flex h-full flex-1 flex-col"
            data-card-creation-status={
              cardCreationStatus === undefined ? "loading" : "ready"
            }
            onSubmit={handleTextSubmit}
          >
            <Textarea
              autoFocus={autoFocus}
              className="h-full min-h-20 flex-1 resize-none rounded-none border-0 bg-transparent p-4 shadow-none focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
              disabled={!canCreateCard}
              id="content"
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (handleFullScreenShortcut(e)) {
                  return;
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (hasContent && canCreateCard) {
                    handleTextSubmit(
                      e as unknown as React.FormEvent<HTMLFormElement>
                    ).catch(console.error);
                  }
                }
              }}
              placeholder={inlinePlaceholderText}
              ref={textareaRef}
              value={content}
            />

            <div className="flex justify-end gap-2 p-3">
              {hasContent && (
                <>
                  <Button
                    aria-label="Open full-screen note"
                    className="w-8 px-0"
                    disabled={!canCreateCard || isSubmitting}
                    onClick={() => setIsFullScreenOpen(true)}
                    size="sm"
                    title="Open full-screen note"
                    type="button"
                    variant="outline"
                  >
                    <Maximize2 className="size-4" />
                  </Button>
                  <Button
                    disabled={!canCreateCard || isSubmitting}
                    size="sm"
                    type="submit"
                  >
                    Save
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
