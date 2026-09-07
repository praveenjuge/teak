import { useCallback, useEffect, useState } from "react";
import { type AuthStateResponse, MESSAGE_TYPES } from "../types/messages";

interface User {
  email: string;
  id: string;
  image?: string;
  name?: string;
}

interface Session {
  user: User;
}

interface UseExtensionSessionResult {
  data: Session | null;
  error: Error | null;
  hasPendingFlow: boolean;
  isPending: boolean;
  pendingCount: number;
  refetch: () => void;
}

export function useExtensionSession(): UseExtensionSessionResult {
  const [data, setData] = useState<Session | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasPendingFlow, setHasPendingFlow] = useState(false);

  const fetchSession = useCallback(async () => {
    setError(null);

    try {
      const state = (await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_AUTH_STATE,
      })) as AuthStateResponse & { message?: string; status?: string };
      if (state.status === "error") {
        throw new Error(state.message || "Could not load your account.");
      }
      setHasPendingFlow(Boolean(state.pending));
      setPendingCount(state.pendingCount ?? 0);
      setData(state.authenticated && state.user ? { user: state.user } : null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setData(null);
    } finally {
      setIsPending(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Refresh the display state when the background completes sign-in or sign-out.
  useEffect(() => {
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (
        areaName === "local" &&
        (changes.teakOAuthState || changes.teakPendingSaveChanged)
      ) {
        void fetchSession();
      }
    };

    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, [fetchSession]);

  return {
    data,
    error,
    hasPendingFlow,
    pendingCount,
    isPending,
    refetch: fetchSession,
  };
}
