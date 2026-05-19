import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import {
  loadThemePreference,
  persistThemePreference,
  type ThemePreference,
} from "@/lib/theme-preference-storage";
import {
  applyAppearancePreference,
  type ResolvedThemeScheme,
  resolveThemeScheme,
} from "./theme-preference-native";

interface ThemePreferenceContextValue {
  isLoaded: boolean;
  preference: ThemePreference;
  resolvedScheme: ResolvedThemeScheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemePreferenceContext =
  createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const stored = await loadThemePreference();
      if (isMounted && stored) {
        setPreferenceState(stored);
        applyAppearancePreference(stored, Appearance);
      }
      if (isMounted) {
        setIsLoaded(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    applyAppearancePreference(preference, Appearance);
  }, [isLoaded, preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void persistThemePreference(next);
  }, []);

  const resolvedScheme = useMemo(
    () => resolveThemeScheme(preference, systemScheme),
    [preference, systemScheme]
  );

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      preference,
      resolvedScheme,
      setPreference,
      isLoaded,
    }),
    [preference, resolvedScheme, setPreference, isLoaded]
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error(
      "useThemePreference must be used within ThemePreferenceProvider"
    );
  }
  return context;
}
