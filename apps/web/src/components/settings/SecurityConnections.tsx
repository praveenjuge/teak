"use client";

import { api } from "@teak/convex";
import type { TeakTranslator } from "@teak/i18n";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { useState } from "react";
import { AppWindow, Laptop, Smartphone, type VadivamIcon } from "vadivam-react";
import { usePaginatedQuery } from "../../lib/convexQueryHooks";
import { RetryableQueryBoundary } from "../feedback/RetryableQueryBoundary";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Spinner } from "../ui/spinner";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsListSkeleton,
} from "./SettingsDialog";
import { SettingsSection } from "./SettingsSection";

export interface DeviceSession {
  /** What the session's browser says; absent from older servers. */
  agent?: { browser?: string; kind: string; os?: string };
  current: boolean;
  id: string;
  lastActiveAt?: number;
  /** The server's English name, shown when `agent` is missing. */
  name: string;
  signedInAt: number;
}

// Product names, the same in every language.
const BROWSER_NAMES: Record<string, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
};
const SYSTEM_NAMES: Record<string, string> = {
  android: "Android",
  ios: "iOS",
  ipados: "iPadOS",
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
};
const MOBILE_SYSTEMS = new Set(["android", "ios", "ipados"]);

/** A device's name in the UI's language, from the parts the server sends. */
export function deviceName(
  session: Pick<DeviceSession, "agent" | "name">,
  t: ConnectionsTranslator
): string {
  const { agent } = session;
  if (!agent) {
    return session.name;
  }
  if (agent.kind === "extension") {
    return t("deviceExtension");
  }
  if (agent.kind !== "browser") {
    return t("deviceUnknown");
  }
  const browser =
    (agent.browser && BROWSER_NAMES[agent.browser]) || t("deviceBrowser");
  const os = agent.os && SYSTEM_NAMES[agent.os];
  return os ? t("deviceOn", { browser, os }) : browser;
}

/** This device first, then the rest in the server's order (newest first). */
export function orderDeviceSessions<T extends { current: boolean }>(
  sessions: T[]
): T[] {
  return [
    ...sessions.filter((session) => session.current),
    ...sessions.filter((session) => !session.current),
  ];
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
  onRevokeOtherSessions?: () => Promise<{
    hasMore: boolean;
    revokedCount: number;
  }>;
  onRevokeSession: (sessionId: string, current: boolean) => Promise<void>;
  sessions: DeviceSession[] | undefined;
  sessionsError?: string | null;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
}

type ConnectionsTranslator = TeakTranslator<"settings.connections">;

const formatDate = (locale: string | undefined, date: number) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
const formatDateTime = (locale: string | undefined, date: number) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

interface ConnectionConfirm {
  confirmLabel: string;
  description: string;
  title: string;
}

interface ConnectionRow {
  action: () => Promise<void>;
  actionLabel: string;
  confirm: ConnectionConfirm;
  current?: boolean;
  detail: string;
  id: string;
  lastUsedAt?: number;
  mobile?: boolean;
  name: string;
}

export function deviceSignOutConfirm(
  session: {
    current: boolean;
    name: string;
    signedInAt: number;
  },
  t: ConnectionsTranslator,
  locale: string | undefined
): ConnectionConfirm {
  return session.current
    ? {
        title: t("signOutCurrentTitle"),
        description: t("signOutCurrentDescription", { name: session.name }),
        confirmLabel: t("signOut"),
      }
    : {
        title: t("signOutTitle", { name: session.name }),
        description: t("signOutDescription", {
          name: session.name,
          date: formatDateTime(locale, session.signedInAt),
        }),
        confirmLabel: t("signOut"),
      };
}

export function appDisconnectConfirm(
  name: string,
  t: ConnectionsTranslator
): ConnectionConfirm {
  return {
    title: t("disconnectTitle", { name }),
    description: t("disconnectDescription", { name }),
    confirmLabel: t("disconnect"),
  };
}

function ConnectionList({
  icon,
  label,
  rows,
  verb,
}: {
  icon: (row: ConnectionRow) => VadivamIcon;
  label: string;
  rows: ConnectionRow[];
  verb: string;
}) {
  const t = useTranslations("settings.connections");
  const locale = useIntlLocale();
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
      setError(t("updateFailed"));
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
      <SettingsList label={label}>
        {rows.map((row) => {
          const RowIcon = icon(row);
          return (
            <li
              className="flex items-center gap-3 px-4 py-3"
              data-testid={`connection-${row.id}`}
              key={row.id}
            >
              <RowIcon className="size-[18px] shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 truncate font-medium text-sm">
                    {row.name}
                  </p>
                  {row.current ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] text-muted-foreground leading-4">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      {t("thisDevice")}
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-xs leading-5">
                  {row.detail}
                  {row.lastUsedAt
                    ? ` · ${t("lastUsed", { date: formatDate(locale, row.lastUsedAt) })}`
                    : null}
                </p>
              </div>
              <Button
                aria-label={row.actionLabel}
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
          );
        })}
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

function ReadError({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm"
      role="alert"
    >
      <p className="text-destructive">{message}</p>
      <Button onClick={retry} size="sm" variant="outline">
        {tc("tryAgain")}
      </Button>
    </div>
  );
}

function deviceIcon(row: ConnectionRow): VadivamIcon {
  return row.mobile || MOBILE_DEVICE.test(row.name) ? Smartphone : Laptop;
}

const MOBILE_DEVICE = /iphone|ipad|android|ios|mobile/i;

function SignOutOtherDevices({
  onRevokeOtherSessions,
}: {
  onRevokeOtherSessions: NonNullable<
    SecurityConnectionsProps["onRevokeOtherSessions"]
  >;
}) {
  const t = useTranslations("settings.connections");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const run = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onRevokeOtherSessions();
      setFeedback({
        error: false,
        message: result.hasMore
          ? t("otherDevicesRemaining", { count: result.revokedCount })
          : t("otherDevicesSignedOut", { count: result.revokedCount }),
      });
    } catch {
      setFeedback({ error: true, message: t("updateFailed") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
        size="sm"
        variant="ghost"
      >
        {busy ? <Spinner /> : null}
        {t("signOutOthers")}
      </Button>
      {feedback ? (
        <p
          className={
            feedback.error
              ? "text-destructive text-xs leading-5"
              : "text-muted-foreground text-xs leading-5"
          }
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      <ConfirmDialog
        confirmLabel={t("signOutOthersConfirm")}
        description={t("signOutOthersDescription")}
        onConfirm={() => void run()}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title={t("signOutOthersTitle")}
      />
    </div>
  );
}

function DeviceList(props: SecurityConnectionsProps) {
  const t = useTranslations("settings.connections");
  const locale = useIntlLocale();
  if (!props.sessions && props.sessionsError) {
    return (
      <ReadError
        message={t("devicesLoadFailed")}
        retry={props.onRetrySessions}
      />
    );
  }
  if (!props.sessions) {
    return <SettingsListSkeleton label={t("loadingDevices")} rows={1} />;
  }
  const rows = orderDeviceSessions(props.sessions).map((session) => {
    const name = deviceName(session, t);
    const signedIn = formatDateTime(locale, session.signedInAt);
    return {
      id: session.id,
      name,
      current: session.current,
      mobile: MOBILE_SYSTEMS.has(session.agent?.os ?? ""),
      detail: session.lastActiveAt
        ? t("signedInLastActive", {
            date: signedIn,
            active: formatDateTime(locale, session.lastActiveAt),
          })
        : t("signedIn", { date: signedIn }),
      actionLabel: t(session.current ? "signOutCurrentLabel" : "signOutLabel", {
        name,
      }),
      confirm: deviceSignOutConfirm({ ...session, name }, t, locale),
      action: () => props.onRevokeSession(session.id, session.current),
    };
  });
  const hasOthers = rows.some((row) => !row.current);
  return (
    <div className="space-y-2">
      {props.sessionsError ? (
        <ReadError
          message={t("devicesLoadFailed")}
          retry={props.onRetrySessions}
        />
      ) : null}
      <ConnectionList
        icon={deviceIcon}
        label={t("devicesTitle")}
        rows={rows}
        verb={t("signOut")}
      />
      {rows.length === 0 ? (
        <SettingsEmptyState>{t("noDevices")}</SettingsEmptyState>
      ) : null}
      {hasOthers && props.onRevokeOtherSessions ? (
        <SignOutOtherDevices
          onRevokeOtherSessions={props.onRevokeOtherSessions}
        />
      ) : null}
      {props.sessionsHasMore || props.sessionsLoadingMore ? (
        <Button
          className="w-full"
          disabled={props.sessionsLoadingMore}
          onClick={props.onLoadMoreSessions}
          size="sm"
          variant="outline"
        >
          {props.sessionsLoadingMore ? <Spinner /> : t("showMoreDevices")}
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
  const t = useTranslations("settings.connections");
  const locale = useIntlLocale();
  const connections = usePaginatedQuery(
    api.workosConsents.listConnections,
    retryKey ? { retryKey } : {},
    { initialNumItems: 25 }
  );
  if (connections.status === "LoadingFirstPage") {
    return <SettingsListSkeleton label={t("loadingApps")} rows={1} />;
  }
  const rows = connections.results.map((connection) => ({
    id: connection.consentId,
    name: connection.name,
    detail: t("connected", {
      date: formatDate(locale, connection.connectedAt),
    }),
    actionLabel: t("disconnectLabel", { name: connection.name }),
    lastUsedAt: connection.lastUsedAt,
    confirm: appDisconnectConfirm(connection.name, t),
    action: () => onRevokeConnection({ consentId: connection.consentId }),
  }));
  return (
    <div className="space-y-2">
      <ConnectionList
        icon={() => AppWindow}
        label={t("appsTitle")}
        rows={rows}
        verb={t("disconnect")}
      />
      {rows.length === 0 && connections.status === "Exhausted" ? (
        <SettingsEmptyState>{t("noApps")}</SettingsEmptyState>
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
            t("showMoreApps")
          )}
        </Button>
      )}
    </div>
  );
}

export function SecurityConnections(props: SecurityConnectionsProps) {
  const t = useTranslations("settings.connections");
  const identity = props.connectionIdentity;
  return (
    <div className="flex flex-col gap-10" key={identity?.key}>
      <SettingsSection
        description={t("devicesDescription")}
        id="devices"
        title={t("devicesTitle")}
      >
        <DeviceList {...props} />
      </SettingsSection>
      <SettingsSection
        description={t("appsDescription")}
        id="connected-apps"
        title={t("appsTitle")}
      >
        {identity ? (
          <RetryableQueryBoundary
            fallback={(retry) => (
              <ReadError message={t("appsLoadFailed")} retry={retry} />
            )}
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
          <SettingsListSkeleton label={t("loadingApps")} rows={1} />
        )}
      </SettingsSection>
    </div>
  );
}
