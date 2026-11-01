import {
  htmlLang,
  LOCALE_NAMES,
  type Locale,
  SUPPORTED_LOCALES,
} from "@teak/i18n";
import { useTranslations, useUiLocale } from "@teak/i18n/react";
import { useMemo } from "react";
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

/**
 * Each language's name in the UI's language, shown after its own name
 * ("Deutsch" with "German" in English, "English" with "Englisch" in German).
 * Left out where it would repeat the language's own name.
 */
export function languageSecondaryNames(
  uiLocale: string
): Record<Locale, string | null> {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([uiLocale], {
      type: "language",
      languageDisplay: "standard",
    });
  } catch {
    names = null;
  }
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((option) => {
      let name: string | undefined;
      try {
        name = names?.of(option);
      } catch {
        name = undefined;
      }
      // Without Intl.DisplayNames, English is the one name that can't be
      // wrong for an English UI; other UIs show the native name alone.
      if (!name || name === option) {
        name = uiLocale === "en" ? LOCALE_NAMES[option].english : undefined;
      }
      const shown =
        name &&
        name.toLocaleLowerCase(uiLocale) !==
          LOCALE_NAMES[option].native.toLocaleLowerCase(uiLocale)
          ? name
          : null;
      return [option, shown];
    })
  ) as Record<Locale, string | null>;
}

export function LanguageRow({ locale, onChange, pending }: LanguageSetting) {
  const t = useTranslations("settings.language");
  const uiLocale = htmlLang(useUiLocale());
  const secondary = useMemo(() => languageSecondaryNames(uiLocale), [uiLocale]);
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
        <SelectContent align="end" aria-label={t("label")}>
          {SUPPORTED_LOCALES.map((option) => (
            <SelectItem
              key={option}
              lang={option}
              textValue={LOCALE_NAMES[option].native}
              value={option}
            >
              {LOCALE_NAMES[option].native}
              {secondary[option] ? (
                <span className="text-muted-foreground" lang={uiLocale}>
                  {secondary[option]}
                </span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
