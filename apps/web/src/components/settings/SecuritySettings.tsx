"use client";

import { useTranslations } from "@teak/i18n/react";
import {
  SecurityConnections,
  type SecurityConnectionsProps,
} from "./SecurityConnections";
import { SettingsPageIntro, SettingsStack } from "./SettingsSection";

export function SecuritySettings(props: SecurityConnectionsProps) {
  const tPages = useTranslations("settings.pages");
  return (
    <>
      <SettingsPageIntro
        description={tPages("security.description")}
        title={tPages("security.title")}
      />
      <SettingsStack>
        <SecurityConnections {...props} />
      </SettingsStack>
    </>
  );
}
