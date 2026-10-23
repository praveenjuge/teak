"use client";

import { api } from "@teak/convex";
import { AppWindow, Laptop, type LucideIcon, Smartphone } from "lucide-react";
import { useState } from "react";
import { usePaginatedQuery } from "../../lib/convexQueryHooks";
import { RetryableQueryBoundary } from "../feedback/RetryableQueryBoundary";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Spinner } from "../ui/spinner";
import {
  SettingsEmptyState,
  SettingsIconTile,
  SettingsList,
  SettingsListSkeleton,
} from "./SettingsDialog";

export interface DeviceSession {
  current: boolean;
  id: string;
  name: string;
  signedInAt: number;
}

export interface ConnectionTarget {
  consentId: string;
}

export interface ConnectionIdentity {
  cacheKey: string;
  key: string;
}

export interface SecurityConnectionsProps {
  connectionIdentity?: ConnectionIdentity;
  onLoadMoreSessions: () => void;
  onRetrySessions?: () => void;
  onRevokeConnection: (target: ConnectionTarget) => Promise<void>;
  onRevokeSession: (sessionId: string, current: boolean) => Promise<void>;
  sessions: DeviceSession[] | undefined;
  sessionsError?: string | null;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
// Devices often share a browser name; the sign-in time tells them apart.
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ConnectionConfirm {
  confirmLabel: string;
  description: string;
  title: string;
}

interface ConnectionRow {
  action: () => Promise<void>;
  confirm: ConnectionConfirm;
  current?: boolean;
  date: number;
  detail: string;
  id: string;
  lastUsedAt?: number;
  name: string;
  showTime?: boolean;
}

/** What signing out a device asks before it acts. */
export function deviceSignOutConfirm(session: {
  current: boolean;
  name: string;
  signedInAt: number;
}): ConnectionConfirm {
  return session.current
    ? {
        title: "Sign out of this device?",
        description: `You’ll be signed out of Teak in this browser (${session.name}) and need to sign in again.`,
        confirmLabel: "Sign out",
      }
    : {
        title: `Sign out ${session.name}?`,
        description: `The ${session.name} session that signed in ${dateTimeFormatter.format(session.signedInAt)} is signed out of Teak and needs to sign in again.`,
        confirmLabel: "Sign out",
      };
}

/** What disconnecting an app asks before it acts. */
export function appDisconnectConfirm(name: string): ConnectionConfirm {
  return {
    title: `Disconnect ${name}?`,
    description: `${name} loses access to your Teak library on every installation until you connect it again.`,
    confirmLabel: "Disconnect",
  };
}

function ConnectionList({
  icon,
  rows,
  verb,
}: {
  icon: (row: ConnectionRow) => LucideIcon;
  rows: ConnectionRow[];
  verb: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ConnectionRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revoke = async (row: ConnectionRow) => {
    setBusy(row.id);
    setError(null);
    try {
      await row.action();
    } catch {
      setError("Could not update this connection. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  if (rows.length === 0) {
    return null;
  }
  return (
    <>
      {error ? (
        <p className="mb-2 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsList>
        {rows.map((row) => (
          <li
            className="flex items-center gap-3 px-4 py-3"
            data-testid={`connection-${row.id}`}
            key={row.id}
          >
            <SettingsIconTile icon={icon(row)} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 truncate font-medium text-sm">
                  {row.name}
                </p>
                {row.current ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] text-muted-foreground leading-4">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    This device
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs leading-5">
                {row.detail}{" "}
                {(row.showTime ? dateTimeFormatter : dateFormatter).format(
                  row.date
                )}
                {row.lastUsedAt
                  ? ` · Last used ${dateFormatter.format(row.lastUsedAt)}`
                  : null}
              </p>
            </div>
            <Button
              aria-label={`${verb} ${row.name}${row.current ? " (this device)" : ""}`}
              className="text-muted-foreground hover:text-foreground"
              disabled={busy !== null}
              onClick={() => {
                setPending(row);
                setConfirmOpen(true);
              }}
              size="sm"
              variant="ghost"
            >
              {busy === row.id ? <Spinner /> : <span>{verb}</span>}
            </Button>
          </li>
        ))}
      </SettingsList>
      {pending ? (
        <ConfirmDialog
          {...pending.confirm}
          onConfirm={() => void revoke(pending)}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
        />
      ) : null}
    </>
  );
}

function ReadError({ label, retry }: { label: string; retry?: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm"
      role="alert"
    >
      <p className="text-destructive">
        Could not load {label}. Please try again.
      </p>
      <Button onClick={retry} size="sm" variant="outline">
        Try again
      </Button>
    </div>
  );
}

function deviceIcon(row: ConnectionRow): LucideIcon {
  return MOBILE_DEVICE.test(row.name) ? Smartphone : Laptop;
}

const MOBILE_DEVICE = /iphone|ipad|android|ios|mobile/i;

function DeviceList(props: SecurityConnectionsProps) {
  if (!props.sessions && props.sessionsError) {
    return <ReadError label="devices" retry={props.onRetrySessions} />;
  }
  if (!props.sessions) {
    return <SettingsListSkeleton label="Loading devices…" rows={1} />;
  }
  const rows = props.sessions.map((session) => ({
    id: session.id,
    name: session.name,
    date: session.signedInAt,
    current: session.current,
    detail: "Signed in",
    showTime: true,
    confirm: deviceSignOutConfirm(session),
    action: () => props.onRevokeSession(session.id, session.current),
  }));
  return (
    <div className="space-y-2">
      {props.sessionsError ? (
        <ReadError label="devices" retry={props.onRetrySessions} />
      ) : null}
      <ConnectionList icon={deviceIcon} rows={rows} verb="Sign out" />
      {rows.length === 0 ? (
        <SettingsEmptyState>No devices.</SettingsEmptyState>
      ) : null}
      {props.sessionsHasMore || props.sessionsLoadingMore ? (
        <Button
          className="w-full"
          disabled={props.sessionsLoadingMore}
          onClick={props.onLoadMoreSessions}
          size="sm"
          variant="outline"
        >
          {props.sessionsLoadingMore ? <Spinner /> : "Show more devices"}
        </Button>
      ) : null}
    </div>
  );
}

function WorkosApps({
  onRevokeConnection,
  retryKey,
}: Pick<SecurityConnectionsProps, "onRevokeConnection"> & {
  retryKey?: string;
}) {
  const connections = usePaginatedQuery(
    api.workosConsents.listConnections,
    retryKey ? { retryKey } : {},
    { initialNumItems: 25 }
  );
  if (connections.status === "LoadingFirstPage") {
    return <SettingsListSkeleton label="Loading apps…" rows={1} />;
  }
  const rows = connections.results.map((connection) => ({
    id: connection.consentId,
    name: connection.name,
    date: connection.connectedAt,
    detail: "Connected",
    lastUsedAt: connection.lastUsedAt,
    confirm: appDisconnectConfirm(connection.name),
    action: () => onRevokeConnection({ consentId: connection.consentId }),
  }));
  return (
    <div className="space-y-2">
      <ConnectionList icon={() => AppWindow} rows={rows} verb="Disconnect" />
      {rows.length === 0 && connections.status === "Exhausted" ? (
        <SettingsEmptyState>No apps are connected.</SettingsEmptyState>
      ) : null}
      {connections.status === "Exhausted" ? null : (
        <Button
          className="w-full"
          disabled={connections.status === "LoadingMore"}
          onClick={() => connections.loadMore(25)}
          size="sm"
          variant="outline"
        >
          {connections.status === "LoadingMore" ? (
            <Spinner />
          ) : (
            "Show more apps"
          )}
        </Button>
      )}
    </div>
  );
}

function SectionHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-muted-foreground text-xs leading-5">{description}</p>
    </div>
  );
}

export function SecurityConnections(props: SecurityConnectionsProps) {
  const identity = props.connectionIdentity;
  return (
    <div className="space-y-7" key={identity?.key}>
      <section aria-label="Devices">
        <SectionHeading
          description="Browsers and devices signed in to your account."
          title="Devices"
        />
        <DeviceList {...props} />
      </section>
      <section aria-label="Connected apps">
        <SectionHeading
          description="Disconnecting signs an app out across all its installations."
          title="Connected apps"
        />
        {identity ? (
          <RetryableQueryBoundary
            fallback={(retry) => <ReadError label="apps" retry={retry} />}
            initialKey={identity.cacheKey}
            key={identity.key}
          >
            {(retryKey) => (
              <WorkosApps
                onRevokeConnection={props.onRevokeConnection}
                retryKey={retryKey}
              />
            )}
          </RetryableQueryBoundary>
        ) : (
          <SettingsListSkeleton label="Loading apps…" rows={1} />
        )}
      </section>
    </div>
  );
}
