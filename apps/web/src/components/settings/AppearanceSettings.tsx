"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ThemeValue } from "@/constants/settings";
import type { LanguageSetting } from "@/hooks/useLanguageSetting";
import { LanguageRow } from "./LanguageRow";
import {
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";
import { ThemeToggle } from "./ThemeToggle";

interface AppearanceSettingsProps {
  /** The Language card; left out where there is no locale provider. */
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
      <SettingsPageIntro
        description={tPages("appearance.description")}
        title={tPages("appearance.title")}
      />
      <SettingsStack>
        <SettingsSection
          description={t("themeDescription")}
          id="theme"
          title={t("themeTitle")}
        >
          <ThemeToggle onThemeChange={onThemeChange} />
        </SettingsSection>
        {language ? (
          <SettingsSection
            action={<LanguageRow {...language} />}
            description={t("languageDescription")}
            id="language"
            title={t("languageTitle")}
          />
        ) : null}
      </SettingsStack>
    </>
  );
}
