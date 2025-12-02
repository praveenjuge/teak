import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance, ColorSchemeName, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

type ThemePreference = "system" | "light" | "dark";

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  resolvedScheme: Exclude<ColorSchemeName, null>;
  setPreference: (preference: ThemePreference) => void;
  isLoaded: boolean;
};

const STORAGE_KEY = "teak.themePreference";

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
    Appearance.setColorScheme(null);
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
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (
          isMounted &&
          (stored === "light" || stored === "dark" || stored === "system")
        ) {
          setPreferenceState(stored);
          applyAppearancePreference(stored);
        }
      } finally {
        if (isMounted) {
          setIsLoaded(true);
        }
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
    if (next === "system") {
      void SecureStore.deleteItemAsync(STORAGE_KEY);
      return;
    }
    void SecureStore.setItemAsync(STORAGE_KEY, next);
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
