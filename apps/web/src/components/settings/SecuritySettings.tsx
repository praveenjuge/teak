"use client";

import { useTranslations } from "@teak/i18n/react";
import { Button } from "../ui/button";
import {
  SecurityConnections,
  type SecurityConnectionsProps,
} from "./SecurityConnections";
import {
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";

function DeleteAccountSection({
  onDeleteClick,
}: {
  onDeleteClick: () => void;
}) {
  const t = useTranslations("settings.dangerZone");
  return (
    <SettingsSection
      action={
        <Button
          className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDeleteClick}
          size="sm"
          variant="outline"
        >
          {t("action")}
        </Button>
      }
      id="danger-zone"
      title={t("title")}
      tone="destructive"
    />
  );
}

export function SecuritySettings({
  onDeleteClick,
  ...connections
}: SecurityConnectionsProps & { onDeleteClick: () => void }) {
  const tPages = useTranslations("settings.pages");
  return (
    <>
      <SettingsPageIntro title={tPages("security.title")} />
      <SettingsStack>
        <SecurityConnections {...connections} />
        <DeleteAccountSection onDeleteClick={onDeleteClick} />
      </SettingsStack>
    </>
  );
}
