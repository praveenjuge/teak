import { Platform, PlatformColor } from "react-native";

const createPlatformColor = (
  iosColor: string,
  androidColorOnLightMode: string,
  androidColorOnDarkMode: string,
  fallback: string
) => {
  if (Platform.OS === "ios") {
    return PlatformColor(iosColor);
  }
  if (Platform.OS === "android") {
    // dark mode
    if (PlatformColor("isDarkMode")) {
      return PlatformColor(androidColorOnDarkMode);
    }
    // light mode
    if (PlatformColor("isLightMode")) {
      return PlatformColor(androidColorOnLightMode);
    }
  }
  return fallback;
};

export const colors = {
  primary: "#dc2626",

  // Background colors
  background: createPlatformColor(
    "secondarySystemGroupedBackground",
    "@android:color/system_background_dark",
    "@android:color/system_background_light",
    "#ffffff"
  ),

  // Text colors
  label: createPlatformColor(
    "label",
    "@android:color/white",
    "@android:color/black",
    "#000000"
  ),
  secondaryLabel: createPlatformColor(
    "secondaryLabel",
    "@android:color/light_gray",
    "@android:color/darker_gray",
    "#3c3c43"
  ),

  // Semantic colors
  systemGreen: createPlatformColor(
    "systemGreen",
    "?attr/colorSuccess",
    "?attr/colorPrimary",
    "#34c759"
  ),
  systemRed: createPlatformColor(
    "systemRed",
    "?attr/colorError",
    "?attr/colorError",
    "#ff3b30"
  ),

  // Border colors
  border: createPlatformColor(
    "separator",
    "?android:attr/listDivider",
    "?android:attr/listDivider",
    "#d1d1d6"
  ),

  // White and black that adapt to theme
  adaptiveWhite: createPlatformColor(
    "systemBackground",
    "@android:color/system_background_light",
    "@android:color/system_background_dark",
    "#ffffff"
  ),
  adaptiveBlack: createPlatformColor(
    "label",
    "@android:color/system_background_light",
    "@android:color/system_background_dark",
    "#000000"
  ),
} as const;
