"use client";

import { api } from "@teak/convex";
import { Component, type ReactNode, useState } from "react";
import { usePaginatedQuery } from "../../convexQueryHooks";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

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
interface ConnectionRow {
  action: () => Promise<void>;
  current?: boolean;
  date: number;
  detail: string;
  id: string;
  lastUsedAt?: number;
  name: string;
}

function ConnectionList({
  rows,
  verb,
}: {
  rows: ConnectionRow[];
  verb: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <>
      {error ? (
        <p className="py-2 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="divide-y">
        {rows.map((row) => (
          <li
            className="flex items-center justify-between gap-3 py-3"
            data-testid={`connection-${row.id}`}
            key={row.id}
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate font-medium text-sm">{row.name}</p>
              <p className="text-muted-foreground text-xs">
                {row.detail} · {dateFormatter.format(row.date)}
              </p>
              {row.lastUsedAt ? (
                <p className="text-muted-foreground text-xs">
                  Last used {dateFormatter.format(row.lastUsedAt)}
                </p>
              ) : null}
            </div>
            <Button
              aria-label={`${verb} ${row.name}${row.current ? " (this device)" : ""}`}
              disabled={busy !== null}
              onClick={() => void revoke(row)}
              size="sm"
              variant="ghost"
            >
              {busy === row.id ? <Spinner /> : verb}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function ReadError({ label, retry }: { label: string; retry?: () => void }) {
  return (
    <div role="alert">
      <p>Could not load {label}. Please try again.</p>
      <Button onClick={retry} variant="ghost">
        Try again
      </Button>
    </div>
  );
}

// Error boundaries require a class; each cached read has its own retry subscription.
// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require a class lifecycle.
class ConnectionReadBoundary extends Component<
  {
    label: string;
    initialKey?: string;
    children: (retryKey: string | undefined) => ReactNode;
  },
  { failed: boolean; retryKey: string | undefined }
> {
  state: { failed: boolean; retryKey: string | undefined } = {
    failed: false,
    retryKey: undefined,
  };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <ReadError
        label={this.props.label}
        retry={() =>
          this.setState({ failed: false, retryKey: crypto.randomUUID() })
        }
      />
    ) : (
      this.props.children(this.state.retryKey ?? this.props.initialKey)
    );
  }
}

function DeviceList(props: SecurityConnectionsProps) {
  if (!props.sessions && props.sessionsError) {
    return <ReadError label="devices" retry={props.onRetrySessions} />;
  }
  if (!props.sessions) {
    return (
      <p className="py-6 text-muted-foreground text-sm">
        <Spinner /> Loading devices…
      </p>
    );
  }
  const rows = props.sessions.map((session) => ({
    id: session.id,
    name: session.name,
    date: session.signedInAt,
    current: session.current,
    detail: session.current ? "This device · Signed in" : "Signed in",
    action: () => props.onRevokeSession(session.id, session.current),
  }));
  return (
    <>
      {props.sessionsError ? (
        <ReadError label="devices" retry={props.onRetrySessions} />
      ) : null}
      <ConnectionList rows={rows} verb="Sign out" />
      {rows.length === 0 ? (
        <p className="py-6 text-muted-foreground text-sm">No devices.</p>
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
    </>
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
    return (
      <p className="py-6 text-muted-foreground text-sm">
        <Spinner /> Loading apps…
      </p>
    );
  }
  const rows = connections.results.map((connection) => ({
    id: connection.consentId,
    name: connection.name,
    date: connection.connectedAt,
    detail: "Connected",
    lastUsedAt: connection.lastUsedAt,
    action: () => onRevokeConnection({ consentId: connection.consentId }),
  }));
  return (
    <>
      <p className="py-2 text-muted-foreground text-sm">
        Disconnect signs out this app across all its installations.
      </p>
      <ConnectionList rows={rows} verb="Disconnect" />
      {rows.length === 0 && connections.status === "Exhausted" ? (
        <p className="py-6 text-muted-foreground text-sm">
          No apps are connected.
        </p>
      ) : null}
      {connections.status === "Exhausted" ? null : (
        <Button
          disabled={connections.status === "LoadingMore"}
          onClick={() => connections.loadMore(25)}
          size="sm"
          variant="ghost"
        >
          {connections.status === "LoadingMore" ? (
            <Spinner />
          ) : (
            "Show more apps"
          )}
        </Button>
      )}
    </>
  );
}

export function SecurityConnections(props: SecurityConnectionsProps) {
  const identity = props.connectionIdentity;
  return (
    <div className="space-y-5" key={identity?.key}>
      <section aria-label="Devices">
        <h3 className="font-medium text-sm">Devices</h3>
        <DeviceList {...props} />
      </section>
      <section aria-label="Connected apps">
        <h3 className="font-medium text-sm">Connected apps</h3>
        {identity ? (
          <ConnectionReadBoundary
            initialKey={identity.cacheKey}
            key={identity.key}
            label="apps"
          >
            {(retryKey) => (
              <WorkosApps
                onRevokeConnection={props.onRevokeConnection}
                retryKey={retryKey}
              />
            )}
          </ConnectionReadBoundary>
        ) : (
          <p className="py-6 text-muted-foreground text-sm">
            <Spinner /> Loading apps…
          </p>
        )}
      </section>
    </div>
  );
}
