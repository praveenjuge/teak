import { useState, useEffect, useCallback } from "react";
import { getSessionTokenFromCookies } from "../utils/getSessionFromCookies";

interface User {
  id: string;
  email: string;
  name?: string;
  image?: string;
}

interface Session {
  user: User;
}

interface UseWebAppSessionResult {
  data: Session | null;
  isPending: boolean;
  error: Error | null;
  refetch: () => void;
}

const baseURL = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://app.teakvault.com";

/**
 * Custom hook to get the session from the web app.
 * 
 * In development: Uses credentials: "include" which works with localhost
 * In production: Reads cookie via chrome.cookies API and passes via Authorization header
 */
export function useWebAppSession(): UseWebAppSessionResult {
  const [data, setData] = useState<Session | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSession = useCallback(async () => {
    setIsPending(true);
    setError(null);

    try {
      let response: Response;

      if (import.meta.env.DEV) {
        // In development, credentials: "include" works with localhost
        response = await fetch(`${baseURL}/api/auth/get-session`, {
          method: "GET",
          credentials: "include",
        });
      } else {
        // In production, read the cookie via chrome.cookies API
        const token = await getSessionTokenFromCookies();

        if (!token) {
          console.log("[useWebAppSession] No session token found in cookies");
          setData(null);
          setIsPending(false);
          return;
        }

        // Use Authorization header with Bearer token format
        // The token is the session token value from the cookie
        response = await fetch(`${baseURL}/api/auth/get-session`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
          credentials: "omit",
        });
      }

      if (!response.ok) {
        console.error("[useWebAppSession] Response not ok:", response.status);
        throw new Error("Failed to fetch session");
      }

      const sessionData = await response.json();
      console.log("[useWebAppSession] Session data:", sessionData);

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
      console.error("[useWebAppSession] Error:", err);
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setData(null);
    } finally {
      setIsPending(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  return {
    data,
    isPending,
    error,
    refetch: fetchSession,
  };
}
