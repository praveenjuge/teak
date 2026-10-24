import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import {
  LINK_PASTE_ACTIVE_CODE,
  LINK_PASTE_LIMIT,
  LINK_PASTE_MAX_INPUT,
} from "@teak/convex/shared/constants";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Maximize2 } from "vadivam-react";
import { MarkdownTextEditor } from "@/components/text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MANUAL_CLOSE_TOAST_OPTIONS, TOAST_IDS } from "@/constants/toast";
import { useGlobalFileDrop } from "@/hooks";
import { useServerErrors } from "@/hooks/useServerErrors";
import { cn } from "@/lib/utils";
import { useCardLinkEditor } from "../../hooks/useCardLinkEditor";
import { useWarnBeforeUnload } from "../../hooks/useWarnBeforeUnload";
import { addCaptureToSearchQueries } from "../../lib/cardQueryOptimisticUpdates";
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
  extractLinkList,
  noteCaptureSavedMessage,
  prepareNoteCapture,
} from "../text-editor/noteCapture";
import { useFocusMode } from "../text-editor/useFocusMode";
import {
  addLinkPasteJob,
  finishLinkPasteJob,
  type PasteJob,
  useLinkPasteJobs,
} from "./linkPasteJobs";
import { linkPasteToast } from "./linkPasteToast";

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

function isPasteActiveError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { data?: { code?: unknown } }).data?.code === LINK_PASTE_ACTIVE_CODE
  );
}

/**
 * Keeps a pasted list's toast up to date while the server saves the links,
 * then swaps it for how the job ended. Renders nothing.
 */
function LinkPasteProgressToast({
  job,
  onFinished,
  onUpgrade,
}: {
  job: PasteJob;
  /** `reachedLimit`: the job's last toast already offered the upgrade. */
  onFinished: (jobId: Id<"linkPasteJobs">, reachedLimit: boolean) => void;
  onUpgrade: () => void;
}) {
  const t = useTranslations("forms.pasteLinks");
  const tLimits = useTranslations("forms.limits");
  const progress = useQuery(api.card.pasteLinks.getLinkPaste, {
    jobId: job.jobId,
  });
  const finishedRef = useRef<boolean>(false);

  useEffect(() => {
    if (progress === undefined || finishedRef.current) {
      return;
    }
    if (progress === null) {
      finishedRef.current = true;
      toast.dismiss(job.toastId);
      onFinished(job.jobId, false);
      return;
    }
    const { kind, message } = linkPasteToast(progress, job.extraOmitted, t);
    if (kind === "loading") {
      toast.loading(message, { id: job.toastId });
      return;
    }
    if (kind === "success") {
      toast.success(message, { id: job.toastId });
    } else if (kind === "limit") {
      toast.error(message, {
        ...MANUAL_CLOSE_TOAST_OPTIONS,
        action: { label: tLimits("upgrade"), onClick: onUpgrade },
        id: job.toastId,
      });
    } else {
      toast.error(message, { id: job.toastId });
    }
    finishedRef.current = true;
    onFinished(job.jobId, kind === "limit");
  }, [job, onFinished, onUpgrade, progress, t, tLimits]);

  // A composer that goes away mid-job leaves no spinner behind; the job
  // carries on, its cards still arrive, and the next composer picks it up.
  useEffect(
    () => () => {
      if (!finishedRef.current) {
        toast.dismiss(job.toastId);
      }
    },
    [job.toastId]
  );

  return null;
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
  const t = useTranslations("forms.addCard");
  const tLimits = useTranslations("forms.limits");
  const tPaste = useTranslations("forms.pasteLinks");
  const tEditor = useTranslations("textEditor");
  const tc = useTranslations("common");
  const errors = useServerErrors();
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
    ? t("placeholder")
    : t("upgradePlaceholder");
  const inlinePlaceholderText = basePlaceholderText;
  const focusPlaceholderText = basePlaceholderText;
  const hasContent = Boolean(content.trim());
  // A draft that is only links, one per line, saves one link card each.
  const linkList = useMemo(() => extractLinkList(content), [content]);
  // Links already in Teak only move, so a list stays savable at the limit;
  // the job stops at the first new link past it.
  const canSubmit = canCreateCard || linkList !== null;
  let saveLabel = tc("save");
  if (linkList && linkList.length > LINK_PASTE_LIMIT) {
    saveLabel = t("saveFirstLinks", { count: LINK_PASTE_LIMIT });
  } else if (linkList) {
    saveLabel = t("saveLinks", { count: linkList.length });
  }
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
      toast.error(tLimits("cardLimitReached"), {
        ...MANUAL_CLOSE_TOAST_OPTIONS,
        action: {
          label: tLimits("upgrade"),
          onClick: handleUpgrade,
        },
        id: toastId,
      });
    },
    [handleUpgrade, tLimits]
  );

  const pasteJobs = useLinkPasteJobs();
  const pasteInProgress = pasteJobs.length > 0;

  // A paste that stops at the limit says so in its own toast; one that saves
  // every link but lands on the limit leaves it to the upgrade toast.
  const handlePasteFinished = useCallback(
    (jobId: Id<"linkPasteJobs">, reachedLimit: boolean) => {
      if (reachedLimit) {
        hasShownBlockedToastRef.current = true;
      }
      finishLinkPasteJob(jobId);
    },
    []
  );

  useEffect(() => {
    if (cardCreationStatus?.canCreateCard === false) {
      // Wait for a paste to finish, so its toast can say it first.
      if (!(hasShownBlockedToastRef.current || pasteInProgress)) {
        showUpgradeToast();
        hasShownBlockedToastRef.current = true;
      }
      return;
    }

    hasShownBlockedToastRef.current = false;
  }, [cardCreationStatus?.canCreateCard, pasteInProgress, showUpgradeToast]);

  const createCard = useMutation(
    api.cards.createCardWithOutcome
  ).withOptimisticUpdate((localStore, args) => {
    addCaptureToSearchQueries(localStore, {
      content: args.content ?? "",
      id: crypto.randomUUID() as Id<"cards">,
      now: Date.now(),
    });
  });
  const startLinkPaste = useMutation(api.card.pasteLinks.startLinkPaste);

  const resetDraft = () => {
    setContent("");
  };

  // A failed save puts the draft back, ahead of anything typed since.
  const restoreDraft = (submittedContent: string) => {
    const newerDraft = latestContentRef.current;
    setContent(
      newerDraft.trim()
        ? `${submittedContent}\n\n${newerDraft}`
        : submittedContent
    );
  };

  // The draft is cleared as a note is sent, so until the server has it,
  // closing the tab would lose it.
  const [savingNotes, setSavingNotes] = useState(0);
  useWarnBeforeUnload(savingNotes > 0);

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
      addLinkPasteJob({
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
    const submittedContent = latestContentRef.current;
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

    const toastId = toast.loading(tc("saving"));
    captureEvent("card_create_submitted", {
      card_type: "text",
      source: "web",
      via: "text_form",
    });

    setSavingNotes((count) => count + 1);
    try {
      const capture = prepareNoteCapture(submittedContent);
      const saved = await createCard({ ...capture, source: "web" });

      onSuccess?.();
      if (saved.outcome === "resaved") {
        toast.success(
          saved.wasArchived ? t("resavedFromArchive") : t("resaved"),
          {
            id: toastId,
            ...(onOpenCard && {
              action: {
                label: t("open"),
                onClick: () => onOpenCard(saved.cardId),
              },
            }),
          }
        );
      } else {
        toast.success(noteCaptureSavedMessage(capture, tEditor), {
          id: toastId,
        });
      }
      return true;
    } catch (error) {
      console.error("Failed to create card:", error);

      restoreDraft(submittedContent);

      const errorMessage = errors.message(
        error,
        error instanceof Error ? error.message : t("saveFailed")
      );

      if (isCardLimitError(error)) {
        showUpgradeToast(toastId);
      } else if (isRateLimitError(error)) {
        toast.error(tLimits("rateLimited"), {
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
      {pasteJobs.map((job) => (
        <LinkPasteProgressToast
          job={job}
          key={job.jobId}
          onFinished={handlePasteFinished}
          onUpgrade={handleUpgrade}
        />
      ))}
      <FocusEditor
        canSave={Boolean(content.trim() && canSubmit)}
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
              ariaLabel={tEditor("note.contentLabel")}
              autoFocus={autoFocus}
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
                if (hasContent && canSubmit) {
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
                    disabled={!canSubmit}
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
