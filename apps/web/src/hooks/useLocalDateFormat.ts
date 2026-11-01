import { useIntlLocale } from "@teak/i18n/react";
import { useMemo } from "react";
import { useHydrated } from "./useHydrated";

/**
 * Formats dates in the browser's time zone once the page has hydrated. The
 * server renders in its own zone (UTC in production), so a date it formatted
 * wouldn't match the browser's; until hydration this returns null and the
 * caller leaves the date out. Pass options defined once, outside the
 * component.
 */
export function useLocalDateFormat(
  options: Intl.DateTimeFormatOptions
): ((value: number) => string) | null {
  const locale = useIntlLocale();
  const hydrated = useHydrated();
  const format = useMemo(
    () => new Intl.DateTimeFormat(locale, options),
    [locale, options]
  );
  return hydrated ? (value) => format.format(value) : null;
}
