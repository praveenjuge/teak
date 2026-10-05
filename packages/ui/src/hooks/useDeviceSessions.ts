"use client";

import { api } from "@teak/convex";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceSession } from "../components/settings/SecuritySection";

// Actions do not subscribe: keep pages local, discard stale responses on account/mode changes.
export function useDeviceSessions(
  identityKey: string | undefined,
  provider: "betterauth" | "workos" | undefined
) {
  const list = useAction(api.securitySessions.listAuthkitSessions);
  const activeIdentity = useRef(identityKey);
  activeIdentity.current = identityKey;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [state, setState] = useState<{
    key?: string;
    rows?: DeviceSession[];
    cursor: string | null;
    failedCursor?: string | null;
    hasMore: boolean;
    loading: boolean;
    error: string | null;
  }>({ cursor: null, hasMore: false, loading: false, error: null });
  const load = useCallback(
    async (cursor: string | null = null) => {
      if (
        !identityKey ||
        provider !== "workos" ||
        identityKey !== activeIdentity.current ||
        inFlight.current
      ) {
        return;
      }
      const request = generation.current;
      inFlight.current = true;
      setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const result = await list({ paginationOpts: { cursor, numItems: 25 } });
        if (request !== generation.current) {
          return;
        }
        setState((previous) => ({
          key: identityKey,
          rows: [
            ...new Map(
              [...(cursor ? (previous.rows ?? []) : []), ...result.page].map(
                (row) => [row.id, row]
              )
            ).values(),
          ],
          cursor: result.continueCursor || null,
          hasMore: !result.isDone,
          loading: false,
          error: null,
        }));
      } catch {
        if (request !== generation.current) {
          return;
        }
        setState((previous) => ({
          ...previous,
          key: identityKey,
          loading: false,
          error: "Could not load devices. Please try again.",
          failedCursor: cursor,
        }));
      } finally {
        if (request === generation.current) {
          inFlight.current = false;
        }
      }
    },
    [identityKey, provider, list]
  );
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setState({
      key: identityKey,
      cursor: null,
      hasMore: false,
      loading: false,
      error: null,
    });
    void load();
    return () => {
      generation.current++;
      inFlight.current = false;
    };
  }, [identityKey, load]);
  const visible = state.key === identityKey;
  return {
    sessions: visible ? state.rows : undefined,
    sessionsHasMore: visible && state.hasMore,
    sessionsLoadingMore: visible && state.loading && state.rows !== undefined,
    sessionsError: provider === "workos" && visible ? state.error : null,
    retrySessions: () => void load(state.failedCursor ?? null),
    loadMoreSessions: () => {
      if (state.hasMore) {
        void load(state.cursor);
      }
    },
    isCurrentIdentity: () =>
      Boolean(identityKey && identityKey === activeIdentity.current),
    refreshSessions: () => {
      if (provider !== "workos" || identityKey !== activeIdentity.current) {
        return Promise.resolve();
      }
      generation.current++;
      inFlight.current = false;
      return load();
    },
  };
}
