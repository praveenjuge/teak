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

const isLocale = (value: string): value is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

export function LanguageRow({ locale, onChange, pending }: LanguageSetting) {
  const t = useTranslations("settings.language");
  // The development pseudo-locale isn't a choice: it reads as English, and
  // nothing is selected, so picking English turns it off.
  const selected = isLocale(locale) ? locale : "";
  const value = selected || "en";
  return (
    <div className="flex items-center gap-2">
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
  );
}
