import type { TeakTranslator } from "@teak/i18n";
import { toast } from "sonner";
import { englishTranslator } from "./englishTranslators";

export type ClipboardTranslator = TeakTranslator<"lib.clipboard">;

const englishClipboard: ClipboardTranslator =
  englishTranslator("lib.clipboard");

export async function copyColorHexToClipboard(
  hex: string,
  t: ClipboardTranslator = englishClipboard
) {
  try {
    await navigator.clipboard.writeText(hex);
    toast.success(t("copiedColor", { hex }));
  } catch (error) {
    console.error("Failed to copy color", error);
    toast.error(t("copyFailed"));
  }
}
