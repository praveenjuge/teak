import type { englishMessages } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { SettingRow, SettingValueSkeleton } from "./SettingRow";
import { SettingsFooter } from "./SettingsFooter";

type SettingsRowKey = keyof typeof englishMessages.settings.rows;

const SKELETON_ROWS: [row: SettingsRowKey, width: string][] = [
  ["email", "w-44"],
  ["usage", "w-16"],
  ["plan", "w-28"],
  ["saveByEmail", "w-10"],
  ["security", "w-16"],
  ["importExport", "w-16"],
  ["theme", "w-24"],
  ["language", "w-28"],
  ["signOut", "w-16"],
];

export function SettingsContentSkeleton() {
  const t = useTranslations("settings");
  return (
    <>
      <span className="sr-only" role="status">
        {t("skeleton.loading")}
      </span>
      {SKELETON_ROWS.map(([row, width]) => (
        <SettingRow key={row} title={t(`rows.${row}`)}>
          <SettingValueSkeleton className={width} />
        </SettingRow>
      ))}
      <SettingsFooter />
    </>
  );
}
