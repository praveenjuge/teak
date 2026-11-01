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
  rows,
  verb,
}: {
  icon: (row: ConnectionRow) => VadivamIcon;
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
      <SettingsList>
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
  return MOBILE_DEVICE.test(row.name) ? Smartphone : Laptop;
}

const MOBILE_DEVICE = /iphone|ipad|android|ios|mobile/i;

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
  const rows = props.sessions.map((session) => ({
    id: session.id,
    name: session.name,
    current: session.current,
    detail: t("signedIn", {
      date: formatDateTime(locale, session.signedInAt),
    }),
    actionLabel: t(session.current ? "signOutCurrentLabel" : "signOutLabel", {
      name: session.name,
    }),
    confirm: deviceSignOutConfirm(session, t, locale),
    action: () => props.onRevokeSession(session.id, session.current),
  }));
  return (
    <div className="space-y-2">
      {props.sessionsError ? (
        <ReadError
          message={t("devicesLoadFailed")}
          retry={props.onRetrySessions}
        />
      ) : null}
      <ConnectionList icon={deviceIcon} rows={rows} verb={t("signOut")} />
      {rows.length === 0 ? (
        <SettingsEmptyState>{t("noDevices")}</SettingsEmptyState>
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
