"use client";

import { type ComponentProps, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ApiKeysPanel } from "./ApiKeysDialog";
import {
  SecurityConnections,
  type SecurityConnectionsProps,
} from "./SecurityConnections";

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
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[82vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Security</DialogTitle>
            <DialogDescription>
              Manage access to your Teak account.
            </DialogDescription>
          </DialogHeader>
          <SecurityTabs apiKeys={apiKeys} {...connections} />
        </DialogContent>
      </Dialog>
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
    <Tabs defaultValue="connections">
      <TabsList>
        <TabsTrigger value="connections">Connections</TabsTrigger>
        <TabsTrigger value="keys">API keys</TabsTrigger>
      </TabsList>
      <TabsContent value="connections">
        <SecurityConnections {...connections} />
      </TabsContent>
      <TabsContent value="keys">
        <ApiKeysPanel {...apiKeys} />
      </TabsContent>
    </Tabs>
  );
}
