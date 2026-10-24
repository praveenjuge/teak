"use client";

import { useTranslations } from "@teak/i18n/react";
import { ShieldCheck } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ApiKeysPanel } from "./ApiKeysDialog";
import {
  SecurityConnections,
  type SecurityConnectionsProps,
} from "./SecurityConnections";
import {
  SettingsDialog,
  settingsTabsClassName,
  settingsTabsContentClassName,
  settingsTabsListClassName,
  settingsTabsTriggerClassName,
} from "./SettingsDialog";

export type {
  ConnectionIdentity,
  ConnectionTarget,
  DeviceSession,
} from "./SecurityConnections";

import { SettingRow } from "./SettingRow";

export function SecuritySection({
  apiKeys,
  ...connections
}: SecurityConnectionsProps & {
  apiKeys: ComponentProps<typeof ApiKeysPanel>;
}) {
  const t = useTranslations("settings.security");
  const tRows = useTranslations("settings.rows");
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow title={tRows("security")}>
        <Button
          aria-label={t("manageLabel")}
          onClick={() => setOpen(true)}
          size="sm"
          variant="link"
        >
          {t("manage")}
        </Button>
      </SettingRow>
      <SettingsDialog
        className="sm:h-[min(88dvh,40rem)] sm:max-w-xl"
        description={t("description")}
        icon={ShieldCheck}
        onOpenChange={setOpen}
        open={open}
        title={t("title")}
      >
        <SecurityTabs apiKeys={apiKeys} {...connections} />
      </SettingsDialog>
    </>
  );
}

function SecurityTabs({
  apiKeys,
  ...connections
}: SecurityConnectionsProps & {
  apiKeys: ComponentProps<typeof ApiKeysPanel>;
}) {
  const t = useTranslations("settings.security");
  return (
    <Tabs className={settingsTabsClassName} defaultValue="connections">
      <TabsList className={settingsTabsListClassName}>
        <TabsTrigger
          className={settingsTabsTriggerClassName}
          value="connections"
        >
          {t("connectionsTab")}
        </TabsTrigger>
        <TabsTrigger className={settingsTabsTriggerClassName} value="keys">
          {t("apiKeysTab")}
        </TabsTrigger>
      </TabsList>
      <TabsContent className={settingsTabsContentClassName} value="connections">
        <SecurityConnections {...connections} />
      </TabsContent>
      <TabsContent className={settingsTabsContentClassName} value="keys">
        <ApiKeysPanel {...apiKeys} />
      </TabsContent>
    </Tabs>
  );
}
