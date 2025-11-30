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
 * Custom hook to get the session from the web app by using the session cookie.
 * This allows the extension to share authentication with the web app.
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

      // Fetch the session from the web app with the cookie
      const response = await fetch(`${baseURL}/api/auth/get-session`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `better-auth.session_token=${token}`,
        },
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
