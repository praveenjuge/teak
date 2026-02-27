import type { SymbolViewProps, SymbolWeight } from "expo-symbols";
import { SymbolView } from "expo-symbols";
import type { StyleProp, ViewStyle } from "react-native";

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = "regular",
  animationSpec,
}: {
  name: SymbolViewProps["name"];
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
  animationSpec?: SymbolViewProps["animationSpec"];
}) {
  return (
    <SymbolView
      animationSpec={animationSpec}
      name={name}
      resizeMode="scaleAspectFit"
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
      tintColor={color}
      weight={weight}
    />
  );
}
