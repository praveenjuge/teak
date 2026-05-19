import type { ColorSchemeName } from "react-native";
import type { ThemePreference } from "@/lib/theme-preference-storage";

export type ResolvedThemeScheme = "light" | "dark";
export type NativeThemeOverride = ResolvedThemeScheme | "unspecified";

export interface AppearancePreferenceApi {
  setColorScheme: (scheme: NativeThemeOverride) => void;
}

export const resolveThemeScheme = (
  preference: ThemePreference,
  nativeScheme: ColorSchemeName
): ResolvedThemeScheme => {
  if (preference === "system") {
    return nativeScheme === "dark" ? "dark" : "light";
  }

  return preference;
};

export const applyAppearancePreference = (
  preference: ThemePreference,
  appearance: AppearancePreferenceApi
) => {
  appearance.setColorScheme(
    preference === "system" ? "unspecified" : preference
  );
};
