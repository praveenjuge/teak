// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { SymbolViewProps, SymbolWeight } from "expo-symbols";
import type { ComponentProps } from "react";
import type { OpaqueColorValue, StyleProp, TextStyle } from "react-native";

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  "house.fill": "home",
  house: "home",
  magnifyingglass: "search",
  "plus.circle.fill": "add-circle",
  "plus.circle": "add-circle-outline",
  "gearshape.fill": "settings",
  gearshape: "settings",
  paperclip: "attach-file",
  "mic.fill": "mic",
  xmark: "close",
  checkmark: "check",
  "checkmark.circle.fill": "check-circle",
  hourglass: "hourglass-empty",
  "exclamationmark.triangle.fill": "warning",
  "info.circle.fill": "info",
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color?: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
  animationSpec?: SymbolViewProps["animationSpec"];
}) {
  return (
    <MaterialIcons
      color={color}
      name={MAPPING[name]}
      size={size}
      style={style}
    />
  );
}
