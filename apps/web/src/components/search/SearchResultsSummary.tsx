import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { Button } from "@/components/ui/button";

export interface SearchResultsSummaryProps {
  /** Cards that hold the search's words. */
  exactCount: number;
  /** Whether more pages of results can still load. */
  hasMore: boolean;
  onShowRelatedChange: (show: boolean) => void;
  /** Cards matched by meaning rather than by the words. */
  relatedCount: number;
  showRelated: boolean;
}

/**
 * How many cards a search found, and how many of them only share its
 * meaning, with a switch to leave those out.
 */
export function SearchResultsSummary({
  exactCount,
  hasMore,
  onShowRelatedChange,
  relatedCount,
  showRelated,
}: SearchResultsSummaryProps) {
  const t = useTranslations("search.results");
  const locale = useIntlLocale();
  return (
    <div className="mb-3 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
      <p aria-atomic="true" aria-live="polite" role="status">
        {hasMore
          ? t("matchesMore", { count: exactCount.toLocaleString(locale) })
          : t("matches", { count: exactCount })}
        {relatedCount > 0 ? (
          <>
            {" · "}
            {t("related", { count: relatedCount })}
          </>
        ) : null}
      </p>
      {relatedCount > 0 ? (
        <Button
          aria-pressed={!showRelated}
          className="h-7 px-2 text-muted-foreground"
          onClick={() => onShowRelatedChange(!showRelated)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {showRelated ? t("hideRelated") : t("showRelated")}
        </Button>
      ) : null}
    </div>
  );
}
