import { Circle, HStack, Image, ScrollView, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  contentShape,
  font,
  foregroundStyle,
  frame,
  onTapGesture,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { PlatformColor } from "react-native";

const chipBackground = background(
  PlatformColor("tertiarySystemFill"),
  shapes.capsule()
);

/** A horizontally scrolling row of capsule chips, like the web's tag badges. */
function ChipRow({
  colors,
  onPressTag,
  sparkles = false,
  tags = [],
}: {
  colors?: string[];
  /** Makes each tag tappable, like the web's tag badges. */
  onPressTag?: (tag: string) => void;
  sparkles?: boolean;
  tags?: string[];
}) {
  return (
    <ScrollView axes="horizontal" showsIndicators={false}>
      <HStack spacing={6}>
        {colors?.map((hex) => (
          <Circle
            key={hex}
            modifiers={[
              frame({ width: 22, height: 22 }),
              foregroundStyle(hex as any),
            ]}
          />
        ))}
        {tags.map((tag) => (
          <HStack
            key={tag}
            modifiers={[
              padding({ horizontal: 10, vertical: 6 }),
              chipBackground,
              ...(onPressTag
                ? [
                    contentShape(shapes.capsule()),
                    onTapGesture(() => onPressTag(tag)),
                    accessibilityLabel(`Search for ${tag}`),
                  ]
                : []),
            ]}
            spacing={4}
          >
            {sparkles ? (
              <Image color="secondary" size={11} systemName="sparkles" />
            ) : null}
            <Text
              modifiers={[
                font({ design: "rounded", size: 13, weight: "medium" }),
              ]}
            >
              {tag}
            </Text>
          </HStack>
        ))}
      </HStack>
    </ScrollView>
  );
}

export { ChipRow };
