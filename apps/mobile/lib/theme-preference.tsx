import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, type ColorSchemeName, useColorScheme } from "react-native";
import {
  loadThemePreference,
  persistThemePreference,
  type ThemePreference,
} from "@/lib/theme-preference-storage";

interface ThemePreferenceContextValue {
  isLoaded: boolean;
  preference: ThemePreference;
  resolvedScheme: Exclude<ColorSchemeName, null>;
  setPreference: (preference: ThemePreference) => void;
}

const ThemePreferenceContext =
  createContext<ThemePreferenceContextValue | null>(null);

const resolveScheme = (
  preference: ThemePreference,
  systemScheme: ColorSchemeName
): Exclude<ColorSchemeName, null> => {
  if (preference === "system") {
    return systemScheme ?? "light";
  }
  return preference;
};

const applyAppearancePreference = (preference: ThemePreference) => {
  if (preference === "system") {
    Appearance.setColorScheme(null as any);
    return;
  }
  Appearance.setColorScheme(preference);
};

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
        applyAppearancePreference(stored);
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
    applyAppearancePreference(preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void persistThemePreference(next);
  }, []);

  const resolvedScheme = useMemo(
    () => resolveScheme(preference, systemScheme),
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
