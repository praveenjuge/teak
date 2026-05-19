import { Platform, PlatformColor } from "react-native";

const createPlatformColor = (
  iosColor: string,
  androidColor: string,
  fallback: string
) => {
  if (Platform.OS === "ios") {
    return PlatformColor(iosColor);
  }

  if (Platform.OS === "android") {
    return PlatformColor(androidColor);
  }

  return fallback;
};

export const colors = {
  primary: "#dc2626",

  // Background colors
  background: createPlatformColor(
    "secondarySystemGroupedBackground",
    "?android:attr/colorBackground",
    "#ffffff"
  ),

  // Text colors
  label: createPlatformColor(
    "label",
    "?android:attr/textColorPrimary",
    "#000000"
  ),
  secondaryLabel: createPlatformColor(
    "secondaryLabel",
    "?android:attr/textColorSecondary",
    "#3c3c43"
  ),

  // Semantic colors
  systemGreen: createPlatformColor(
    "systemGreen",
    "?attr/colorPrimary",
    "#34c759"
  ),
  systemRed: createPlatformColor("systemRed", "?attr/colorError", "#ff3b30"),

  // Border colors
  border: createPlatformColor(
    "separator",
    "?android:attr/listDivider",
    "#d1d1d6"
  ),

  // White and black that adapt to theme
  adaptiveWhite: createPlatformColor(
    "systemBackground",
    "?android:attr/colorBackground",
    "#ffffff"
  ),
  adaptiveBlack: createPlatformColor(
    "label",
    "?android:attr/textColorPrimary",
    "#000000"
  ),
} as const;
