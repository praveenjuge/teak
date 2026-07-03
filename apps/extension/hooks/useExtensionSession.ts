import { useCallback, useEffect, useState } from "react";
import {
  clearLocalSession,
  getConvexSiteUrl,
  getSessionToken,
  hasPendingFlow as readHasPendingFlow,
  PENDING_AUTH_KEY,
  SESSION_TOKEN_KEY,
} from "../lib/nativeAuth";

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
  refetch: () => void;
}

/**
 * Resolves the current session from the extension's own stored session token.
 *
 * The stored dedicated token is sent as a bearer token to get-session on the
 * Convex site URL (the bearer plugin self-signs raw tokens). It must NOT go to
 * the web app URL: in dev that redirects http->https and the browser strips the
 * Authorization header on the cross-scheme hop, silently dropping auth. A 401
 * clears the local session, and a storage listener keeps the popup in sync when
 * the background stores a token after the completion-page handshake.
 */
export function useExtensionSession(): UseExtensionSessionResult {
  const [data, setData] = useState<Session | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasPendingFlow, setHasPendingFlow] = useState(false);

  const fetchSession = useCallback(async () => {
    setIsPending(true);
    setError(null);

    try {
      setHasPendingFlow(await readHasPendingFlow());

      const token = await getSessionToken();
      if (!token) {
        setData(null);
        return;
      }

      const response = await fetch(
        `${getConvexSiteUrl()}/api/auth/get-session`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: "omit",
        }
      );

      if (response.status === 401 || response.status === 403) {
        await clearLocalSession();
        setData(null);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch session");
      }

      const sessionData = await response.json();

      if (sessionData?.session?.userId && sessionData?.user) {
        setData({
          user: {
            id: sessionData.user.id,
            email: sessionData.user.email,
            name: sessionData.user.name,
            image: sessionData.user.image,
          },
        });
      } else {
        setData(null);
      }
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

  // Flip live when the background stores/clears the token or the pending flow
  // changes — e.g. when the completion-page handshake poll succeeds while the
  // popup is open, or when a terminal poll error clears the pending record
  // (which must drop the "Finishing sign-in…" spinner even though the token
  // key never changed).
  useEffect(() => {
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (
        areaName === "local" &&
        (changes[SESSION_TOKEN_KEY] || changes[PENDING_AUTH_KEY])
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
    isPending,
    refetch: fetchSession,
  };
}
