import { Button, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, padding } from "@expo/ui/swift-ui/modifiers";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { MarkdownText } from "@/components/card-sheet/MarkdownText";
import { SheetText } from "@/components/card-sheet/SheetText";
import type { CardSheetDetail } from "@/lib/card-sheet";

// Same cap as the web's file text preview.
const TEXT_PREVIEW_LIMIT = 512 * 1024;
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);
const TEXT_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "csv", "xml"]);

const extensionOf = (name?: string) =>
  name?.split(".").pop()?.toLowerCase() ?? "";

export const textPreviewKind = (
  card: Pick<CardSheetDetail, "fileMetadata">
): "markdown" | "code" | null => {
  const { fileName, fileSize, language, mimeType } = card.fileMetadata ?? {};
  if (typeof fileSize === "number" && fileSize > TEXT_PREVIEW_LIMIT) {
    return null;
  }
  const extension = extensionOf(fileName);
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }
  if (
    language ||
    mimeType?.startsWith("text/") ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "code";
  }
  return null;
};

/**
 * Opens the original file in Safari's viewer, which renders PDFs, Office
 * documents, and text natively, and shows Markdown and source files inline
 * like the web.
 */
function DocumentFileText({ card }: { card: CardSheetDetail }) {
  const kind = textPreviewKind(card);
  const fileUrl = sanitizeExternalUrl(card.fileUrl ?? "");
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!(kind && fileUrl)) {
      return;
    }
    let cancelled = false;
    fetch(fileUrl)
      .then((response) => (response.ok ? response.text() : null))
      .then((body) => {
        if (!cancelled && body && body.length <= TEXT_PREVIEW_LIMIT) {
          setText(body);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileUrl, kind]);

  return (
    <VStack alignment="leading" spacing={12}>
      {text && kind === "markdown" ? (
        <MarkdownText size={16} text={text} />
      ) : null}
      {text && kind === "code" ? (
        <SheetText monospaced selectable size={13}>
          {text}
        </SheetText>
      ) : null}
      {fileUrl ? (
        <Button
          label="View Document"
          modifiers={[
            buttonStyle("glass"),
            controlSize("regular"),
            padding({ bottom: 4 }),
          ]}
          onPress={() => void WebBrowser.openBrowserAsync(fileUrl)}
          systemImage="doc.viewfinder"
        />
      ) : null}
    </VStack>
  );
}

export { DocumentFileText };
