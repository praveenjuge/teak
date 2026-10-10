import { Text } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  lineLimit,
  textSelection,
  type ViewModifier,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { colors } from "@/constants/colors";

type SheetFontWeight = "regular" | "medium" | "semibold" | "bold";

interface SheetTextProps {
  children: ReactNode;
  destructive?: boolean;
  limit?: number;
  /** Renders inline Markdown: bold, italics, code, and links. */
  markdown?: boolean;
  monospaced?: boolean;
  secondary?: boolean;
  selectable?: boolean;
  size?: number;
  weight?: SheetFontWeight;
}

function SheetText({
  children,
  destructive = false,
  limit,
  markdown = false,
  monospaced = false,
  secondary = false,
  selectable = false,
  size,
  weight = "regular",
}: SheetTextProps) {
  const fontParams: {
    design: "rounded" | "monospaced";
    size?: number;
    weight: SheetFontWeight;
  } = { design: monospaced ? "monospaced" : "rounded", weight };
  if (size !== undefined) {
    fontParams.size = size;
  }

  const modifiers: ViewModifier[] = [font(fontParams)];
  if (destructive) {
    modifiers.push(foregroundStyle(colors.systemRed as any));
  } else if (secondary) {
    modifiers.push(
      foregroundStyle({ type: "hierarchical", style: "secondary" })
    );
  }
  if (limit !== undefined) {
    modifiers.push(lineLimit(limit));
  }
  if (selectable) {
    modifiers.push(textSelection(true));
  }

  return (
    <Text markdownEnabled={markdown} modifiers={modifiers}>
      {children}
    </Text>
  );
}

export { SheetText };
