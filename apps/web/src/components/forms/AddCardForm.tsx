import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
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
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { MarkdownTextEditor } from "@/components/text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MANUAL_CLOSE_TOAST_OPTIONS } from "@/constants/toast";
import { useUpgradeAction } from "@/hooks/useUpgradeAction";
import { NEW_NOTE_COMPOSER_ATTRIBUTE } from "@/lib/keyboardShortcuts";
import { cn } from "@/lib/utils";
import { useCanCreateCard } from "../../hooks/useCanCreateCard";
import { useCardLinkEditor } from "../../hooks/useCardLinkEditor";
import { useWarnBeforeUnload } from "../../hooks/useWarnBeforeUnload";
import { readComposerDraft, storeComposerDraft } from "../../lib/composerDraft";
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
import { extractLinkList } from "../text-editor/noteCapture";
import { useFocusMode } from "../text-editor/useFocusMode";
import {
  addLinkPasteJob,
  finishLinkPasteJob,
  type PasteJob,
  useLinkPasteJobs,
  useLinkPasteToastOwner,
} from "./linkPasteJobs";
import { linkPasteToast } from "./linkPasteToast";
import { useSaveNote } from "./useSaveNote";

function isPasteActiveError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { data?: { code?: unknown } }).data?.code === LINK_PASTE_ACTIVE_CODE
  );
}

function LinkPasteProgressToast({
  job,
  onFinished,
  onUpgrade,
}: {
  job: PasteJob;
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

  useLinkPasteToastOwner(job);

  return null;
}

export interface AddCardFormProps {
  autoFocus?: boolean;
  canCreateCard?: boolean;
  draftContentRef?: React.MutableRefObject<string>;
  onFocus?: () => void;
  onOpenCard?: (cardId: string) => void;
  onSuccess?: () => void;
}

export function AddCardForm({
  onSuccess,
  autoFocus,
  canCreateCard: canCreateCardProp,
  draftContentRef,
  onFocus,
  onOpenCard,
}: AddCardFormProps) {
  const t = useTranslations("forms.addCard");
  const tPaste = useTranslations("forms.pasteLinks");
  const tEditor = useTranslations("textEditor");
  const tc = useTranslations("common");
  const authUser = useQuery(api.auth.getAuthUser);
  const accountId =
    authUser && typeof authUser._id === "string" ? authUser._id : null;
  const [content, setInternalContent] = useState(
    () => draftContentRef?.current ?? ""
  );
  const latestContentRef = useRef(content);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  // False once the browser refused to keep the draft, so closing the tab
  // asks first instead of losing it.
  const [draftStored, setDraftStored] = useState(true);
  const setContent = useCallback(
    (nextContent: string) => {
      latestContentRef.current = nextContent;
      setInternalContent(nextContent);
      if (draftContentRef) {
        draftContentRef.current = nextContent;
      }
      const owner = accountIdRef.current;
      if (owner) {
        setDraftStored(storeComposerDraft(owner, nextContent));
      }
    },
    [draftContentRef]
  );
  // Brings the account's draft back after mount (the server render has no
  // storage), or keeps what was typed before the account loaded.
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accountId || restoredForRef.current === accountId) {
      return;
    }
    restoredForRef.current = accountId;
    const current = latestContentRef.current;
    const stored = readComposerDraft(accountId);
    if (stored.trim() && !current.includes(stored)) {
      // Text shared into Teak goes after the draft rather than over it.
      setContent(current.trim() ? `${stored}\n\n${current}` : stored);
      return;
    }
    setDraftStored(storeComposerDraft(accountId, current));
  }, [accountId, setContent]);
  const {
    close: closeFocus,
    inlineEditorValue,
    isFocusOpen,
    open: openFocus,
  } = useFocusMode(content);

  const globalFileDrop = useGlobalFileDrop();
  const accountCanCreateCard = useCanCreateCard();
  const canCreateCard = canCreateCardProp ?? accountCanCreateCard ?? true;
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

  const { handleUpgrade, showUpgradeToast } = useUpgradeAction();

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
    if (accountCanCreateCard === false) {
      // Wait for a paste to finish, so its toast can say it first.
      if (!(hasShownBlockedToastRef.current || pasteInProgress)) {
        showUpgradeToast();
        hasShownBlockedToastRef.current = true;
      }
      return;
    }

    hasShownBlockedToastRef.current = false;
  }, [accountCanCreateCard, pasteInProgress, showUpgradeToast]);

  const { saveNote } = useSaveNote({ onOpenCard, onSuccess });
  const startLinkPaste = useMutation(api.card.pasteLinks.startLinkPaste);

  const resetDraft = () => {
    setContent("");
  };

  const restoreDraft = (submittedContent: string) => {
    const newerDraft = latestContentRef.current;
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
    setSavingNotes((count) => count + 1);
    try {
      return await saveNote(submittedContent, {
        onNotSaved: () => restoreDraft(submittedContent),
        onRestored: () => {
          if (latestContentRef.current.trim() === submittedContent.trim()) {
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
      {pasteJobs.map((job) => (
        <LinkPasteProgressToast
          job={job}
          key={job.jobId}
          onFinished={handlePasteFinished}
          onUpgrade={handleUpgrade}
        />
      ))}
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
        onFocus={onFocus}
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
              autoFocus={autoFocus}
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
