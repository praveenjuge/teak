"use client";

import type { ComponentProps } from "react";
import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ApiKeysPanel } from "./ApiKeysDialog";
import type { OAuthConnection } from "./OAuthConnectionsSection";
import { SettingRow } from "./SettingRow";

export interface DeviceSession {
  current: boolean;
  id: string;
  name: string;
  signedInAt: number;
}

export interface SecurityConnectionsProps {
  connections: OAuthConnection[] | undefined;
  onLoadMoreSessions: () => void;
  onRevokeConnection: (clientId: string) => Promise<void>;
  onRevokeSession: (sessionId: string, current: boolean) => Promise<void>;
  sessions: DeviceSession[] | undefined;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

function ConnectionRow({
  name,
  date,
  current,
  app,
  busy,
  disabled,
  onRevoke,
}: {
  name: string;
  date: number;
  current: boolean;
  app: boolean;
  busy: boolean;
  disabled: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium text-sm">{name}</p>
        <p className="text-muted-foreground text-xs">
          {app ? "App" : "Device"}
          {current ? " · This device" : ""} · {app ? "Connected" : "Signed in"}{" "}
          {dateFormatter.format(date)}
        </p>
        {app ? (
          <p className="text-muted-foreground text-xs">
            Full access to your library
          </p>
        ) : null}
      </div>
      <Button
        aria-label={`${app ? "Disconnect" : "Sign out"} ${name}${current ? " (this device)" : ""}`}
        disabled={disabled}
        onClick={onRevoke}
        size="sm"
        variant="ghost"
      >
        {busy ? <Spinner /> : (app && "Disconnect") || "Sign out"}
      </Button>
    </li>
  );
}

function ConnectionsPanel(props: SecurityConnectionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revoke = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
    } catch {
      setError("Could not update this connection. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  if (!(props.connections && props.sessions)) {
    return (
      <p className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
        <Spinner />
        Loading connections…
      </p>
    );
  }
  const rows = [
    ...props.sessions.map((session) => ({
      id: `device:${session.id}`,
      name: session.name,
      date: session.signedInAt,
      current: session.current,
      app: false,
      action: () => props.onRevokeSession(session.id, session.current),
    })),
    ...props.connections.map((app) => ({
      id: `app:${app.clientId}`,
      name: app.name,
      date: app.connectedAt,
      current: false,
      app: true,
      action: () => props.onRevokeConnection(app.clientId),
    })),
  ].sort((a, b) => Number(b.current) - Number(a.current) || b.date - a.date);
  return (
    <div>
      {error ? (
        <p className="py-2 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="divide-y">
        {rows.map((row) => (
          <ConnectionRow
            {...row}
            busy={busy === row.id}
            disabled={busy !== null}
            key={row.id}
            onRevoke={() => void revoke(row.id, row.action)}
          />
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="py-6 text-muted-foreground text-sm">No connections.</p>
      ) : null}
      {props.sessionsHasMore || props.sessionsLoadingMore ? (
        <Button
          disabled={props.sessionsLoadingMore}
          onClick={props.onLoadMoreSessions}
          size="sm"
          variant="ghost"
        >
          {props.sessionsLoadingMore ? <Spinner /> : "Show more devices"}
        </Button>
      ) : null}
    </div>
  );
}

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
        <ConnectionsPanel {...connections} />
      </TabsContent>
      <TabsContent value="keys">
        <ApiKeysPanel {...apiKeys} />
      </TabsContent>
    </Tabs>
  );
}
