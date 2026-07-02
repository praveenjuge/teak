import { useCallback, useEffect, useState } from "react";
import { authorizeTeak } from "./oauth";
import { getPreferences } from "./preferences";

export interface TeakAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Resolve whether the extension has usable credentials. A grandfathered API key
 * (from preferences) is used as-is; otherwise `authorize()` is invoked directly,
 * which resolves instantly when a valid OAuth token is stored or presents the
 * Raycast OAuth overlay right away (no intermediate confirmation screen).
 * Callers render a loading state while `isLoading` is true and re-check via
 * `refresh()` after sign-in.
 */
export function useTeakAuth(): TeakAuthState {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const refresh = useCallback(() => {
    setReloadNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;

    const resolve = async () => {
      setIsLoading(true);

      // Grandfathered API key takes precedence — no browser sign-in needed.
      if (getPreferences().apiKey?.trim()) {
        if (active) {
          setIsAuthenticated(true);
          setIsLoading(false);
        }
        return;
      }

      let authorized = false;
      try {
        // Presents the Raycast OAuth overlay directly when no valid token
        // exists; returns silently when one does. Guarded so a double-invoked
        // effect can't start two authorizations with mismatched state.
        const token = await authorizeTeak();
        authorized = Boolean(token);
      } catch {
        authorized = false;
      }

      if (active) {
        setIsAuthenticated(authorized);
        setIsLoading(false);
      }
    };

    void resolve();

    return () => {
      active = false;
    };
  }, [reloadNonce]);

  return { isAuthenticated, isLoading, refresh };
}
