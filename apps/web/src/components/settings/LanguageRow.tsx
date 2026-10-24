import { LOCALE_NAMES, type Locale, SUPPORTED_LOCALES } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import type { LanguageSetting } from "@/hooks/useLanguageSetting";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Spinner } from "../ui/spinner";

const FEEDBACK_EMAIL = "hello@praveenjuge.com";

const isLocale = (value: string): value is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

/**
 * The Language setting. Each language shows its own name, with the English
 * name beside it, so anyone can find their way back.
 */
export function LanguageRow({ locale, onChange, pending }: LanguageSetting) {
  const t = useTranslations("settings.language");
  // The development pseudo-locale isn't a choice: it reads as English, and
  // nothing is selected, so picking English turns it off.
  const selected = isLocale(locale) ? locale : "";
  const value = selected || "en";
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2 px-2.5">
        {pending ? <Spinner aria-label={t("saving")} /> : null}
        <Select
          disabled={pending}
          onValueChange={(next) => {
            if (isLocale(next)) {
              onChange(next);
            }
          }}
          value={selected}
        >
          <SelectTrigger aria-label={t("label")} size="sm">
            <SelectValue placeholder={LOCALE_NAMES.en.native}>
              {LOCALE_NAMES[value].native}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {SUPPORTED_LOCALES.map((option) => (
              <SelectItem
                key={option}
                lang={option}
                textValue={LOCALE_NAMES[option].native}
                value={option}
              >
                {LOCALE_NAMES[option].native}
                {option === "en" ? null : (
                  <span className="text-muted-foreground" lang="en">
                    {LOCALE_NAMES[option].english}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <a
        className="px-2.5 text-muted-foreground text-xs hover:underline"
        href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
          t("feedbackSubject", { locale: value })
        )}`}
      >
        {t("feedback")}
      </a>
    </div>
  );
}
