import { useTranslations } from "@teak/i18n/react";
import { X } from "vadivam-react";
import { Button } from "@/components/ui/button";

export interface RemovableSearchChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface NoSearchResultsProps {
  chips: readonly RemovableSearchChip[];
  onClearAll: () => void;
  onUseSuggestion?: (search: string) => void;
  /** The words searched for, shown in the message when there are any. */
  query: string;
  /** A spelling the person's own cards use, offered as "Did you mean". */
  suggestion?: string | null;
  /** The search lists to-do links, so nothing left reads as done. */
  todo?: boolean;
}

/**
 * The empty state of a search: what was searched for, a "Did you mean"
 * from the person's own words, and each filter as a button that drops it.
 */
export function NoSearchResults({
  chips,
  onClearAll,
  onUseSuggestion,
  query,
  suggestion,
  todo = false,
}: NoSearchResultsProps) {
  const t = useTranslations("search.results");
  const tCards = useTranslations("screens.cards");
  let message = tCards("noFilterMatches");
  if (todo) {
    message = tCards("nothingLeftToDo");
  } else if (query) {
    message = t("noMatchesFor", { query });
  }
  return (
    <div className="space-y-4 py-12 text-center">
      <p className="break-words text-muted-foreground" dir="auto">
        {message}
      </p>
      {suggestion && onUseSuggestion ? (
        <p className="text-sm">
          {t.rich("didYouMean", {
            suggestion,
            link: (chunks) => (
              <Button
                className="h-auto p-0 font-medium"
                dir="auto"
                onClick={() => onUseSuggestion(suggestion)}
                type="button"
                variant="link"
              >
                {chunks}
              </Button>
            ),
          })}
        </p>
      ) : null}
      {chips.length > 1 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">{t("tryRemoving")}</p>
          <ul
            aria-label={t("filtersLabel")}
            className="flex flex-wrap justify-center gap-1.5"
          >
            {chips.map((chip) => (
              <li key={chip.key}>
                <Button
                  aria-label={t("removeFilter", { label: chip.label })}
                  className="h-7 max-w-72 gap-1 px-2 text-xs"
                  onClick={chip.onRemove}
                  title={chip.label}
                  type="button"
                  variant="outline"
                >
                  <span className="truncate" dir="auto">
                    {chip.label}
                  </span>
                  <X aria-hidden="true" className="size-3 opacity-60" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button onClick={onClearAll} variant="outline">
        {chips.length === 0 && query
          ? tCards("clearSearch")
          : tCards("clearFilters")}
      </Button>
    </div>
  );
}
