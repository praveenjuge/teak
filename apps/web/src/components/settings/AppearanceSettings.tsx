"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ThemeValue } from "@/constants/settings";
import type { LanguageSetting } from "@/hooks/useLanguageSetting";
import { LanguageRow } from "./LanguageRow";
import {
  SettingsGroup,
  SettingsPageIntro,
  SettingsRow,
} from "./SettingsSection";
import { ThemeToggle } from "./ThemeToggle";

interface AppearanceSettingsProps {
  language?: LanguageSetting | null;
  onThemeChange?: (value: ThemeValue) => void;
}

export function AppearanceSettings({
  language,
  onThemeChange,
}: AppearanceSettingsProps) {
  const t = useTranslations("settings.appearance");
  const tPages = useTranslations("settings.pages");
  return (
    <>
      <SettingsPageIntro title={tPages("appearance.title")} />
      <SettingsGroup>
        <SettingsRow
          action={<ThemeToggle onThemeChange={onThemeChange} />}
          id="theme"
          label={t("themeTitle")}
        />
        {language ? (
          <SettingsRow
            action={<LanguageRow {...language} />}
            id="language"
            label={t("languageTitle")}
          />
        ) : null}
      </SettingsGroup>
    </>
  );
}
