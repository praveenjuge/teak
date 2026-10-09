"use client";

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
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow title="Security">
        <Button onClick={() => setOpen(true)} size="sm" variant="link">
          Manage
        </Button>
      </SettingRow>
      <SettingsDialog
        className="sm:h-[min(88dvh,40rem)] sm:max-w-xl"
        description="Manage the devices, apps and keys that can access your Teak account."
        icon={ShieldCheck}
        onOpenChange={setOpen}
        open={open}
        title="Security"
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
  return (
    <Tabs className={settingsTabsClassName} defaultValue="connections">
      <TabsList className={settingsTabsListClassName}>
        <TabsTrigger
          className={settingsTabsTriggerClassName}
          value="connections"
        >
          Connections
        </TabsTrigger>
        <TabsTrigger className={settingsTabsTriggerClassName} value="keys">
          API keys
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
