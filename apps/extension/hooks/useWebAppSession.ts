import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";
import { useCallback, useEffect, useState } from "react";
import { getSessionTokenFromCookies } from "../utils/getSessionFromCookies";

interface User {
  email: string;
  id: string;
  image?: string;
  name?: string;
}

interface Session {
  user: User;
}

interface UseWebAppSessionResult {
  data: Session | null;
  error: Error | null;
  isPending: boolean;
  refetch: () => void;
}

const baseURL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";

/**
 * Custom hook to get the active Clerk-backed session from the web app.
 */
export function useWebAppSession(): UseWebAppSessionResult {
  const [data, setData] = useState<Session | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSession = useCallback(async () => {
    setIsPending(true);
    setError(null);

    try {
      const token = await getSessionTokenFromCookies();

      if (!token) {
        setData(null);
        setIsPending(false);
        return;
      }

      const response = await fetch(`${baseURL}/api/clerk/session`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
      });

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

  return {
    data,
    isPending,
    error,
    refetch: fetchSession,
  };
}
