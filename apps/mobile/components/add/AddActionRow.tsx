import { Button, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  disabled as disabledModifier,
  font,
  frame,
  shapes,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { PlatformColor } from "react-native";

/** A Settings-style row: a colored icon tile, a label, and a chevron. */
function AddActionRow({
  color,
  disabled = false,
  label,
  onPress,
  systemImage,
}: {
  color: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  systemImage: string;
}) {
  return (
    <Button
      modifiers={[tint(PlatformColor("label")), disabledModifier(disabled)]}
      onPress={onPress}
    >
      <HStack spacing={14}>
        <VStack
          modifiers={[
            frame({ width: 30, height: 30 }),
            background(
              PlatformColor(color),
              shapes.roundedRectangle({
                cornerRadius: 7,
                roundedCornerStyle: "continuous",
              })
            ),
          ]}
        >
          <Image color="white" size={15} systemName={systemImage as any} />
        </VStack>
        <Text modifiers={[font({ design: "rounded" })]}>{label}</Text>
        <Spacer />
        <Image color="tertiary" size={13} systemName="chevron.right" />
      </HStack>
    </Button>
  );
}

export { AddActionRow };
