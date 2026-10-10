import { Divider, HStack, Overlay, Rectangle, VStack } from "@expo/ui/swift-ui";
import {
  background,
  foregroundStyle,
  frame,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useMemo } from "react";
import { PlatformColor } from "react-native";
import { SheetText } from "@/components/card-sheet/SheetText";
import { type MarkdownBlock, parseMarkdownBlocks } from "@/lib/markdown-blocks";

const HEADING_STEPS = [7, 4, 2];

const codeBackground = background(
  PlatformColor("tertiarySystemFill"),
  shapes.roundedRectangle({ cornerRadius: 10 })
);

/**
 * Shows Markdown like the web's note view, with headings, lists, quotes, and
 * code as native selectable text. Inline styles come from SwiftUI's Text.
 */
function MarkdownText({ size, text }: { size: number; text: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);

  const renderBlock = (block: MarkdownBlock, index: number) => {
    switch (block.kind) {
      case "heading":
        return (
          <SheetText
            key={index}
            markdown
            selectable
            size={size + (HEADING_STEPS[block.level - 1] ?? 0)}
            weight="bold"
          >
            {block.text}
          </SheetText>
        );
      case "list":
        return (
          <VStack alignment="leading" key={index} spacing={4}>
            {block.items.map((item, itemIndex) => (
              <HStack
                alignment="firstTextBaseline"
                // biome-ignore lint/suspicious/noArrayIndexKey: list items have no stable id
                key={itemIndex}
                modifiers={[padding({ leading: item.depth * 18 })]}
                spacing={8}
              >
                <SheetText secondary size={size}>
                  {item.marker}
                </SheetText>
                <SheetText markdown selectable size={size}>
                  {item.text}
                </SheetText>
              </HStack>
            ))}
          </VStack>
        );
      case "quote":
        return (
          <Overlay alignment="leading" key={index}>
            <VStack modifiers={[padding({ leading: 14 })]}>
              <SheetText markdown secondary selectable size={size}>
                {block.text}
              </SheetText>
            </VStack>
            <Overlay.Content>
              <Rectangle
                modifiers={[
                  frame({ width: 3 }),
                  foregroundStyle(PlatformColor("separator") as never),
                ]}
              />
            </Overlay.Content>
          </Overlay>
        );
      case "code":
        return (
          <VStack
            alignment="leading"
            key={index}
            modifiers={[
              frame({ maxWidth: 10_000, alignment: "leading" }),
              padding({ all: 10 }),
              codeBackground,
            ]}
          >
            <SheetText monospaced selectable size={size - 3}>
              {block.text}
            </SheetText>
          </VStack>
        );
      case "rule":
        return <Divider key={index} />;
      default:
        return (
          <SheetText key={index} markdown selectable size={size}>
            {block.text}
          </SheetText>
        );
    }
  };

  return (
    <VStack alignment="leading" spacing={10}>
      {blocks.map(renderBlock)}
    </VStack>
  );
}

export { MarkdownText };
