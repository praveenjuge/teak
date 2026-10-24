import type { TimeFilter } from "@teak/convex/shared/utils/timeSearch";
import type { TeakTranslator } from "@teak/i18n";

const RELATIVE_KEYS = {
  Today: "today",
  Yesterday: "yesterday",
  "This Week": "thisWeek",
  "Last Week": "lastWeek",
  "This Month": "thisMonth",
  "Last Month": "lastMonth",
  "This Year": "thisYear",
  "Last Year": "lastYear",
} as const;

const isRelativeLabel = (label: string): label is keyof typeof RELATIVE_KEYS =>
  Object.hasOwn(RELATIVE_KEYS, label);

/**
 * The date pill for a search's date words, in the UI language. People type
 * the words in English ("this week"); English keeps the parser's label.
 */
export const timeFilterLabel = (
  filter: TimeFilter,
  t: TeakTranslator<"search.dates">,
  options: { english: boolean; locale: string | undefined }
): string => {
  if (options.english) {
    return filter.label;
  }
  const start = new Date(filter.range.start);
  const format = (style: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(options.locale, style).format(start);
  switch (filter.kind) {
    case "relative":
      return isRelativeLabel(filter.label)
        ? t(RELATIVE_KEYS[filter.label])
        : filter.label;
    case "weekday": {
      const day = format({ weekday: "long" });
      return filter.label.startsWith("Last ") ? t("lastWeekday", { day }) : day;
    }
    case "date":
      return format({ dateStyle: "medium" });
    case "month":
      return format({ month: "long", year: "numeric" });
    case "year":
      return format({ year: "numeric" });
    default:
      return new Intl.DateTimeFormat(options.locale, {
        dateStyle: "medium",
      }).formatRange(start, new Date(filter.range.end - 1));
  }
};
