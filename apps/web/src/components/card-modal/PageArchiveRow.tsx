import {
  type PageArchiveFailureReason,
  toPageArchiveFailureReason,
} from "@teak/convex/shared/pageArchive";
import { formatBytes } from "@teak/convex/shared/utils/formatBytes";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { Info } from "vadivam-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import type { CardModalCard } from "./types";

export type PageArchiveRowState =
  | { bytes: number; kind: "saved"; textOnly: boolean }
  | { kind: "saving" }
  | { kind: "failed"; reason: PageArchiveFailureReason };

const SAVING = new Set(["pending", "in_progress"]);

/**
 * What the Details row says about a link's saved copy: its size once saved
 * (a copy being refreshed keeps showing the one it has), "Saving a copy…"
 * while the first is made, or why none could be. Nothing for other cards, or
 * a link whose copy was never started.
 */
export const pageArchiveRowState = (
  card: Pick<CardModalCard, "pageArchive" | "processingStatus" | "type">
): PageArchiveRowState | null => {
  if (card.type !== "link") {
    return null;
  }
  if (card.pageArchive) {
    return {
      bytes: card.pageArchive.bytes,
      kind: "saved",
      textOnly: card.pageArchive.kind === "text_only",
    };
  }
  const stage = card.processingStatus?.archive;
  if (stage?.status === "failed") {
    return { kind: "failed", reason: toPageArchiveFailureReason(stage.error) };
  }
  return stage && SAVING.has(stage.status) ? { kind: "saving" } : null;
};

const FAILURE_MESSAGES = {
  archive_error: "archiveFailedUnreachable",
  blocked_url: "archiveFailedBlocked",
  http_error: "archiveFailedUnreachable",
  not_html: "archiveFailedNotPage",
  too_large: "archiveFailedTooLarge",
  unreachable: "archiveFailedUnreachable",
} as const satisfies Record<PageArchiveFailureReason, string>;

/** The side panel's "Archived copy" row, in the Details list. */
export function PageArchiveRow({ card }: { card: CardModalCard }) {
  const t = useTranslations("cardModal.details");
  const locale = useIntlLocale(US_ENGLISH_LOCALE);
  const state = pageArchiveRowState(card);
  if (!state) {
    return null;
  }
  let value: ReactNode;
  if (state.kind === "saved") {
    value = state.textOnly
      ? t("archiveTextOnly")
      : formatBytes(state.bytes, locale);
  } else if (state.kind === "saving") {
    value = (
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <Skeleton aria-hidden="true" className="h-3 w-12" />
        {t("archiveSaving")}
      </span>
    );
  } else {
    const reason = t(FAILURE_MESSAGES[state.reason]);
    value = (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        {t("archiveFailed")}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={reason}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
                type="button"
              >
                <Info aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{reason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </span>
    );
  }
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{t("archive")}</dt>
      <dd className="min-w-0 truncate whitespace-nowrap text-right">{value}</dd>
    </div>
  );
}
