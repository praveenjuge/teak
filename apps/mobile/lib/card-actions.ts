import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { getNativeShareOptions } from "./files";
import { downloadNativeFile } from "./nativeFileSystem";

export const copyTextToClipboard = async (value: string): Promise<void> => {
  await Clipboard.setStringAsync(value);
};

export const isUserShareCancel = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("User did not share");

/**
 * Shares a downloaded card file through the native share sheet. On iOS this
 * doubles as "Save to Files", matching the cards-grid download behavior.
 */
export const shareSheetFile = async (
  url: string,
  fileName: string
): Promise<void> => {
  const uri = await downloadNativeFile(
    url,
    fileName,
    Platform.OS === "ios" ? "cache" : "documents"
  );

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }

  await Sharing.shareAsync(uri, {
    ...getNativeShareOptions(fileName),
    ...(Platform.OS === "ios" ? { dialogTitle: "Save to Files" } : {}),
  });
};
