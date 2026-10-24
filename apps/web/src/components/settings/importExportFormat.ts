import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";

export { formatBytes } from "@teak/convex/shared/utils/formatBytes";

export type FormatTranslator = TeakTranslator<"settings.format">;

const englishFormat: FormatTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "settings.format"
);

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(
  timestamp: number,
  now = Date.now(),
  t: FormatTranslator = englishFormat,
  locale?: string
): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE_MS) {
    return t("justNow");
  }
  if (diff < HOUR_MS) {
    return t("minutesAgo", { count: Math.floor(diff / MINUTE_MS) });
  }
  if (diff < DAY_MS) {
    return t("hoursAgo", { count: Math.floor(diff / HOUR_MS) });
  }
  const days = Math.floor(diff / DAY_MS);
  if (days < 30) {
    return t("daysAgo", { count: days });
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(timestamp)
  );
}

export function formatCountdown(
  remainingMs: number,
  t: FormatTranslator = englishFormat
): string {
  if (remainingMs <= 0) {
    return t("now");
  }
  const totalMinutes = Math.ceil(remainingMs / MINUTE_MS);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? t("daysHours", { days, hours }) : t("days", { days });
  }
  if (hours > 0) {
    return minutes > 0
      ? t("hoursMinutes", { hours, minutes })
      : t("hours", { hours });
  }
  if (minutes > 0) {
    return t("minutes", { minutes });
  }
  return t("underAMinute");
}
