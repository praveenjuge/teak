"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { MANUAL_CLOSE_TOAST_OPTIONS } from "@/constants/toast";
import { useCanCreateCard } from "@/hooks/useCanCreateCard";
import { useUpgradeAction } from "@/hooks/useUpgradeAction";
import { readComposerDraft, storeComposerDraft } from "@/lib/composerDraft";
import { useQuery } from "@/lib/convexQueryHooks";
import { focusNewNoteComposer } from "@/lib/keyboardShortcuts";
import { linkPasteToast } from "./linkPasteToast";

export interface PasteJob {
  extraOmitted: number;
  jobId: Id<"linkPasteJobs">;
  toastId: string | number;
}

/**
 * What every composer on the page shares: the unsaved note, pasted lists of
 * links still saving, and a focus request waiting for a composer to show.
 * The empty library's composer and the grid's swap when the first card
 * arrives, so none of this can live in a composer.
 */
export interface ComposerState extends ComposerRequests {
  addPasteJob: (job: PasteJob) => void;
  content: string;
  /** False once the browser refused to keep the draft. */
  draftStored: boolean;
  /** A composer took focus. */
  focusHandled: () => void;
  focusPending: boolean;
  /** The draft as last set, ahead of the next render. */
  latestContent: () => string;
  pasteInProgress: boolean;
  /** A paste's own toast already said the card limit was reached. */
  pasteReachedLimit: boolean;
  setContent: (content: string) => void;
}

/** What a page asks of the composer; these never change, unlike the draft. */
export interface ComposerRequests {
  /** Puts text shared into Teak after the draft. */
  addSharedText: (text: string) => void;
  /** Focuses the composer on screen, or the next one to show. */
  requestFocus: () => void;
}

const ComposerContext = createContext<ComposerState | null>(null);
const ComposerRequestsContext = createContext<ComposerRequests | null>(null);

const required = <T,>(value: T | null): T => {
  if (value === null) {
    throw new Error("The composer needs a ComposerProvider");
  }
  return value;
};

export const useComposer = (): ComposerState =>
  required(useContext(ComposerContext));

export const useComposerRequests = (): ComposerRequests =>
  required(useContext(ComposerRequestsContext));

/** `text` after `draft`, a blank line between them when both have words. */
const appendText = (draft: string, text: string) => {
  if (!draft.trim()) {
    return text;
  }
  return text.trim() ? `${draft}\n\n${text}` : draft;
};

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

  return null;
}

export function ComposerProvider({ children }: { children: ReactNode }) {
  const authUser = useQuery(api.auth.getAuthUser);
  const accountId = authUser?._id ?? null;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const [content, setContentState] = useState("");
  const latestContentRef = useRef(content);
  const [draftStored, setDraftStored] = useState(true);

  const setContent = useCallback((next: string) => {
    latestContentRef.current = next;
    setContentState(next);
    const owner = accountIdRef.current;
    if (owner) {
      setDraftStored(storeComposerDraft(owner, next));
    }
  }, []);

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
      setContent(appendText(stored, current));
      return;
    }
    setDraftStored(storeComposerDraft(accountId, current));
  }, [accountId, setContent]);

  const addSharedText = useCallback(
    (text: string) => {
      const current = latestContentRef.current;
      if (text.trim() && !current.includes(text)) {
        setContent(appendText(current, text));
      }
    },
    [setContent]
  );

  const [focusPending, setFocusPending] = useState(false);
  const requestFocus = useCallback(() => {
    if (!focusNewNoteComposer()) {
      setFocusPending(true);
    }
  }, []);
  const focusHandled = useCallback(() => setFocusPending(false), []);

  const [pasteJobs, setPasteJobs] = useState<readonly PasteJob[]>([]);
  const addPasteJob = useCallback((job: PasteJob) => {
    setPasteJobs((jobs) => [
      ...jobs.filter((current) => current.jobId !== job.jobId),
      job,
    ]);
  }, []);
  // A paste that stops at the limit says so in its own toast, so the
  // composer's upgrade toast stays quiet until cards can be made again.
  const [pasteReachedLimit, setPasteReachedLimit] = useState(false);
  const canCreateCard = useCanCreateCard();
  if (canCreateCard && pasteReachedLimit) {
    setPasteReachedLimit(false);
  }
  const finishPasteJob = useCallback(
    (jobId: Id<"linkPasteJobs">, reachedLimit: boolean) => {
      if (reachedLimit) {
        setPasteReachedLimit(true);
      }
      setPasteJobs((jobs) => jobs.filter((job) => job.jobId !== jobId));
    },
    []
  );
  const { handleUpgrade } = useUpgradeAction();
  const requests = useMemo<ComposerRequests>(
    () => ({ addSharedText, requestFocus }),
    [addSharedText, requestFocus]
  );

  const state = useMemo<ComposerState>(
    () => ({
      addPasteJob,
      addSharedText,
      content,
      draftStored,
      focusHandled,
      focusPending,
      latestContent: () => latestContentRef.current,
      pasteInProgress: pasteJobs.length > 0,
      pasteReachedLimit,
      requestFocus,
      setContent,
    }),
    [
      addPasteJob,
      addSharedText,
      content,
      draftStored,
      focusHandled,
      focusPending,
      pasteJobs.length,
      pasteReachedLimit,
      requestFocus,
      setContent,
    ]
  );

  return (
    <ComposerRequestsContext.Provider value={requests}>
      <ComposerContext.Provider value={state}>
        {pasteJobs.map((job) => (
          <LinkPasteProgressToast
            job={job}
            key={job.jobId}
            onFinished={finishPasteJob}
            onUpgrade={handleUpgrade}
          />
        ))}
        {children}
      </ComposerContext.Provider>
    </ComposerRequestsContext.Provider>
  );
}
